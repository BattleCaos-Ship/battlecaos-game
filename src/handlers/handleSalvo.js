import { redis } from '../index.js';
import { canFireInSalvo, registerShot } from '../domain/salvo.js';
import { shoot, isShipSunk, markShipSunk } from '../domain/board.js';
import { isFleetSunk } from '../domain/fleet.js';
import { energyGain, addEnergyCapped } from '../domain/energy.js';
import { teamShieldActive, consumeTeamShield } from '../domain/powers.js';
import { broadcastState, publish, sendError } from './helpers.js';
import { log } from '../logger.js';

export async function handleSalvo({ codigo, playerId, x, y }) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);

  if (sala.fase !== 'SALVA') {
    await sendError(playerId, 'fase_incorrecta', { x, y });
    return;
  }

  sala.salvoActual ??= { ultimoDisparo: {} };
  if (!canFireInSalvo(sala.salvoActual, playerId)) {
    await sendError(playerId, 'cadencia_no_cumplida', { x, y });
    return;
  }

  // Lock atómico por celda: si dos compañeros de equipo apuntan a la misma celda
  // en el mismo instante, solo el primero en llegar la resuelve (DOMF1002).
  const lockKey  = `sala:${codigo}:salva:${x}:${y}`;
  const acquired = await redis.set(lockKey, playerId, 'NX', 'EX', 10);
  if (!acquired) {
    await sendError(playerId, 'celda_ya_tomada', { x, y });
    return;
  }

  const jugador = sala.jugadores.find((j) => j.id === playerId);
  const equipoEnemigo = jugador?.equipo === 'A' ? 'B' : 'A';
  const board = sala.tableros?.[equipoEnemigo]; // tablero compartido del equipo rival
  if (!board) {
    await sendError(playerId, 'tablero_no_disponible', { x, y });
    return;
  }

  const impactaria = board.cells[`${x},${y}`] === 'ship';
  if (impactaria && teamShieldActive(sala, equipoEnemigo)) {
    consumeTeamShield(sala, equipoEnemigo);
    registerShot(sala.salvoActual, playerId);
    await redis.set(`sala:${codigo}`, JSON.stringify(sala));
    await sendError(playerId, 'celda_protegida', { x, y });
    await broadcastState(codigo, sala);
    return;
  }

  const result = shoot(board, x, y);
  if (!result.valid) {
    await sendError(playerId, 'celda_ya_disparada', { x, y });
    return;
  }

  registerShot(sala.salvoActual, playerId);

  let shipSunk = false;
  if (result.hit && result.shipId) {
    shipSunk = isShipSunk(board, result.shipId);
    const gain = energyGain(true, shipSunk);
    if (gain > 0) await addEnergyCapped(redis, `sala:${codigo}:energia:${jugador.equipo}`, gain);
    if (shipSunk) {
      markShipSunk(board, result.shipId); // revelar el barco hundido al rival
      await publish('ShipSunk', {
        codigo, shipId: result.shipId, equipoAtacante: jugador.equipo, equipoDueno: equipoEnemigo,
      });
    }
  }

  const shotResult = result.hit ? (shipSunk ? 'sunk' : 'hit') : 'miss';
  await publish('ShotFired', { codigo, playerId, x, y, result: shotResult });
  log.info(`sala ${codigo} — disparo salva (${x},${y}) → ${shotResult}`);

  if (result.hit && isFleetSunk(board)) {
    sala.fase        = 'FIN';
    sala.winner      = jugador.equipo;
    sala.terminadoEn = Date.now();
    sala.salvoActual = null;
    await redis.set(`sala:${codigo}`, JSON.stringify(sala));
    await publish('GameEnded', {
      codigo, winner: jugador.equipo, modo: sala.modo,
      duracion: sala.terminadoEn - (sala.iniciadoEn ?? sala.terminadoEn),
    });
    await broadcastState(codigo, sala);
    log.info(`sala ${codigo} — victoria equipo ${jugador.equipo} (durante salva)`);
    return;
  }

  await redis.set(`sala:${codigo}`, JSON.stringify(sala));
  await broadcastState(codigo);
}
