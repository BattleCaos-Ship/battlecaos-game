import { redis } from '../index.js';
import { validateTurn } from '../domain/engine.js';
import { shoot, isShipSunk, markShipSunk } from '../domain/board.js';
import { isFleetSunk } from '../domain/fleet.js';
import { energyGain, addEnergyCapped } from '../domain/energy.js';
import { teamShieldActive, consumeTeamShield } from '../domain/powers.js';
import { broadcastState, publish, sendError } from './helpers.js';
import { advanceTurn } from './turnFlow.js';
import { log } from '../logger.js';

// Devuelve una celda del tablero que aún no fue disparada (ni hit ni miss), al azar.
function pickRandomUnshot(board) {
  const libres = [];
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      const v = board.cells[`${x},${y}`];
      if (v !== 'hit' && v !== 'miss') libres.push({ x, y });
    }
  }
  return libres.length ? libres[Math.floor(Math.random() * libres.length)] : null;
}

export async function handleShot({ codigo, playerId, x, y }) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);

  try {
    validateTurn(sala, playerId);
  } catch (err) {
    await sendError(playerId, err.code, { x, y });
    return;
  }

  const jugador = sala.jugadores.find((j) => j.id === playerId);
  const equipoEnemigo = jugador.equipo === 'A' ? 'B' : 'A';
  const board = sala.tableros?.[equipoEnemigo]; // tablero COMPARTIDO del equipo rival

  if (!board) {
    await sendError(playerId, 'tablero_no_disponible', { x, y });
    return;
  }

  // El BOT nunca debe quedarse sin jugada válida: si eligió una celda ya disparada, se
  // reemplaza por una libre al azar. Sin esto, un disparo inválido del bot no avanza el
  // turno y, como el bot solo dispara al iniciar un turno nuevo, la partida se colgaría.
  if (playerId === 'bot') {
    const actual = board.cells[`${x},${y}`];
    if (actual === 'hit' || actual === 'miss') {
      const libre = pickRandomUnshot(board);
      if (libre) { x = libre.x; y = libre.y; }
    }
  }

  // Escudo de EQUIPO: si el disparo IMPACTARÍA un barco y el equipo enemigo tiene escudo
  // activo, se bloquea (protege toda la flota) y el escudo se consume. El disparo se dio
  // por usado: el turno AVANZA (si no, el bot no vuelve a disparar y la partida se cuelga).
  const impactaria = board.cells[`${x},${y}`] === 'ship';
  if (impactaria && teamShieldActive(sala, equipoEnemigo)) {
    consumeTeamShield(sala, equipoEnemigo);
    await sendError(playerId, 'celda_protegida', { x, y });
    await advanceTurn(codigo, sala);
    return;
  }

  const result = shoot(board, x, y);
  if (!result.valid) {
    // El bot ya fue redirigido arriba; para humanos, un clic repetido no gasta el turno.
    await sendError(playerId, 'celda_ya_disparada', { x, y });
    return;
  }

  // Energía atómica por equipo (con tope de 5)
  let shipSunk = false;
  if (result.hit && result.shipId) {
    shipSunk = isShipSunk(board, result.shipId);
    const gain = energyGain(true, shipSunk);
    if (gain > 0) await addEnergyCapped(redis, `sala:${codigo}:energia:${jugador.equipo}`, gain);

    if (shipSunk) {
      markShipSunk(board, result.shipId); // revelar el barco hundido al rival
      await publish('ShipSunk', {
        codigo,
        shipId:         result.shipId,
        equipoAtacante: jugador.equipo,
        equipoDueno:    equipoEnemigo,
      });
    }
  }

  const shotResult = result.hit ? (shipSunk ? 'sunk' : 'hit') : 'miss';
  await publish('ShotFired', { codigo, playerId, x, y, result: shotResult });
  log.info(`sala ${codigo} — disparo (${x},${y}) → ${shotResult}`);

  // Victoria
  if (result.hit && isFleetSunk(board)) {
    sala.fase        = 'FIN';
    sala.winner      = jugador.equipo;
    sala.terminadoEn = Date.now();
    await redis.set(`sala:${codigo}`, JSON.stringify(sala));
    await publish('GameEnded', {
      codigo,
      winner:   jugador.equipo,
      modo:     sala.modo,
      duracion: sala.terminadoEn - (sala.iniciadoEn ?? sala.terminadoEn),
    });
    await broadcastState(codigo, sala);
    log.info(`sala ${codigo} — victoria equipo ${jugador.equipo}`);
    return;
  }

  await advanceTurn(codigo, sala);
}
