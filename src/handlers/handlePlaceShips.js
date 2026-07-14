import { redis } from '../index.js';
import { createBoard, placeShip, sizeForMode } from '../domain/board.js';
import { validateFleet } from '../domain/fleet.js';
import { broadcastState, publish, sendError, sendOwnFleets } from './helpers.js';
import { log } from '../logger.js';

export async function handlePlaceShips({ codigo, playerId, ships }) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);

  if (sala.fase !== 'COLOCACION') {
    await sendError(playerId, 'fase_incorrecta');
    return;
  }

  const jugador = sala.jugadores.find((j) => j.id === playerId);
  const equipo = jugador?.equipo;
  if (!equipo) { await sendError(playerId, 'jugador_no_encontrado'); return; }

  try {
    validateFleet(ships);

    // Tablero COMPARTIDO por equipo (A/B). En 2v2 ambos compañeros colocan su flota en
    // el MISMO tablero de equipo; se clona el existente y se agregan los barcos de este
    // jugador (placeShip lanza si se solapa con lo ya colocado por el compañero).
    // Los ids de barco se prefijan con el playerId para no colisionar entre las dos flotas
    // (el registro board.ships necesita claves únicas para detectar hundimientos).
    sala.tableros ??= {};
    const board = sala.tableros[equipo]
      ? structuredClone(sala.tableros[equipo])
      : createBoard(sizeForMode(sala.modo));
    for (const ship of ships) placeShip(board, { ...ship, id: `${playerId}_${ship.id}` });

    sala.tableros[equipo] = board;
    sala.colocados ??= [];
    if (!sala.colocados.includes(playerId)) sala.colocados.push(playerId);

    await redis.set(`sala:${codigo}`, JSON.stringify(sala));

    await publish('ShipsPlaced', { codigo, playerId, equipo });
    log.info(`sala ${codigo} — ${playerId} colocó su flota (equipo ${equipo})`);

    // DOMF502: todos colocaron → avanzar a TURNOS
    const todosColocados = sala.jugadores.every((j) => sala.colocados.includes(j.id));
    if (todosColocados) {
      sala.fase  = 'TURNOS';
      sala.turno = { jugadorActual: sala.jugadores[0].id, numeroTurno: 1 };
      await redis.set(`sala:${codigo}`, JSON.stringify(sala));
      await publish('PhaseChanged', { codigo, from: 'COLOCACION', to: 'TURNOS' });
      await sendOwnFleets(codigo, sala); // reafirma a cada jugador su flota (robusto ante reconexión)
      log.info(`sala ${codigo} → TURNOS (todos colocaron)`);
    }

    await broadcastState(codigo);
  } catch (err) {
    await sendError(playerId, err.code ?? err.message);
  }
}
