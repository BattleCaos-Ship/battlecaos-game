import { redis } from '../index.js';
import { canCountermeasure, isWindowExpired } from '../domain/countermeasure.js';
import { POWER_COSTS } from '../domain/powers.js';
import { broadcastState, publish, sendError } from './helpers.js';
import { log } from '../logger.js';

export async function handleCountermeasure({ codigo, playerId }) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);

  if (!canCountermeasure(sala, playerId)) {
    await sendError(playerId, 'contramedida_no_disponible');
    return;
  }

  if (isWindowExpired(sala.contramedidaActiva)) {
    await sendError(playerId, 'ventana_expirada');
    return;
  }

  // La contramedida cuesta energía de equipo. Si no alcanza, no se puede activar.
  const jugador = sala.jugadores.find((j) => j.id === playerId);
  const equipo  = jugador?.equipo;
  const cost    = POWER_COSTS.contramedida;
  const energia = parseInt(await redis.get(`sala:${codigo}:energia:${equipo}`) ?? '0');
  if (energia < cost) {
    await sendError(playerId, 'energia_insuficiente');
    return;
  }
  await redis.incrby(`sala:${codigo}:energia:${equipo}`, -cost);

  const { powerType } = sala.contramedidaActiva;
  sala.contramedidaActiva = null;
  await redis.set(`sala:${codigo}`, JSON.stringify(sala));

  await publish('PowerCompensated', { codigo, playerId, powerType });
  await broadcastState(codigo);
  log.info(`sala ${codigo} — contramedida activada por ${playerId} (-${cost}E), canceló ${powerType}`);
}
