import { redis } from '../index.js';
import {
  validatePower, POWER_COSTS, OFFENSIVE_POWERS,
  applyBombardeo, applySonar, applyEscudo, applyTormenta,
} from '../domain/powers.js';
import { isFleetSunk } from '../domain/fleet.js';
import { broadcastState, publish, broadcastEvent, sendError } from './helpers.js';
import { log } from '../logger.js';

export async function handlePower({ codigo, playerId, powerType, target }) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);

  const jugador = sala.jugadores.find((j) => j.id === playerId);
  if (!jugador) return;
  const equipoEnemigo = jugador.equipo === 'A' ? 'B' : 'A';

  const energia = parseInt(await redis.get(`sala:${codigo}:energia:${jugador.equipo}`) ?? '0');

  try {
    const { cost } = validatePower(sala, playerId, powerType, energia);

    // Descontar energía antes de aplicar
    if (cost > 0) await redis.incrby(`sala:${codigo}:energia:${jugador.equipo}`, -cost);

    if (OFFENSIVE_POWERS.includes(powerType)) {
      // La ventana de contramedida SOLO tiene sentido si el equipo rival puede pagarla (3E).
      // Si no le alcanza la energía, no se abre ventana ni se muestra el aviso: el poder se
      // aplica de inmediato (evita mostrar una contramedida que el rival no podría usar).
      const enemigoEnergia = parseInt(await redis.get(`sala:${codigo}:energia:${equipoEnemigo}`) ?? '0');
      const rivalPuedeContra = enemigoEnergia >= POWER_COSTS.contramedida;

      sala.contramedidaActiva = {
        powerType,
        atacanteId:    playerId,
        targetEquipo:  equipoEnemigo,
        expiraEn:      Date.now() + (rivalPuedeContra ? 5000 : 0),
        target,
      };
      await redis.set(`sala:${codigo}`, JSON.stringify(sala));

      if (rivalPuedeContra) {
        // Ofrecer la contramedida solo a los jugadores del equipo rival, con ventana de 5s.
        for (const j of sala.jugadores.filter((p) => p.equipo === equipoEnemigo)) {
          await broadcastEvent(j.id, 'poder:contramedida-disponible', { powerType, remaining: 5000 });
        }
        await broadcastState(codigo);
        setTimeout(() => applyOffensivePower(codigo, playerId, powerType, target, equipoEnemigo), 5000);
      } else {
        // El rival no puede contrarrestar → aplicar ya, sin aviso ni espera.
        await applyOffensivePower(codigo, playerId, powerType, target, equipoEnemigo);
      }
    } else {
      // Poderes defensivos: aplicar inmediatamente
      let result;
      if (powerType === 'escudo')   result = applyEscudo(sala, jugador.equipo); // protege toda la flota
      if (powerType === 'tormenta') result = applyTormenta(sala, playerId);

      await redis.set(`sala:${codigo}`, JSON.stringify(sala));
      await publish('PowerUsed', { codigo, playerId, powerType, target, result });
      // Confirmación directa al jugador que usó el poder (para feedback visual).
      await broadcastEvent(playerId, 'poder:resultado', { powerType, result });
      // La Tormenta afecta a AMBOS equipos (salta un turno): se anuncia a toda la sala para
      // que todos vean la animación de "se avecina una tormenta".
      if (powerType === 'tormenta') {
        await broadcastEvent(codigo, 'poder:tormenta', {
          porId:     playerId,
          porNombre: jugador.name,
          equipo:    jugador.equipo,
        });
      }
      await broadcastState(codigo);
      log.info(`sala ${codigo} — poder ${powerType} por ${playerId}`);
    }
  } catch (err) {
    await sendError(playerId, err.code ?? err.message);
  }
}

async function applyOffensivePower(codigo, playerId, powerType, target, equipoEnemigo) {
  try {
    const raw = await redis.get(`sala:${codigo}`);
    if (!raw) return;
    const sala = JSON.parse(raw);

    // Si la contramedida ya fue activada, la ventana fue limpiada por handleCountermeasure
    if (sala.contramedidaActiva?.atacanteId !== playerId) return;

    let result;
    const board = sala.tableros?.[equipoEnemigo];
    if (powerType === 'bombardeo' && board) result = applyBombardeo(board, target.x, target.y);
    if (powerType === 'sonar'     && board) result = applySonar(board, target.x, target.y);

    sala.contramedidaActiva = null;

    // Victoria por BOMBARDEO: si el ataque hundió el último barco del rival, la partida debe
    // terminar aquí. Antes la victoria solo se comprobaba en disparos normales y salva, así
    // que un bombardeo que remataba la flota dejaba la partida en curso (el bot seguía jugando
    // pese a tener toda la flota hundida).
    const jugador = sala.jugadores.find((j) => j.id === playerId);
    const flotaHundida = powerType === 'bombardeo' && board && isFleetSunk(board);
    if (flotaHundida && jugador) {
      sala.fase        = 'FIN';
      sala.winner      = jugador.equipo;
      sala.terminadoEn = Date.now();
    }

    await redis.set(`sala:${codigo}`, JSON.stringify(sala));
    await publish('PowerUsed', { codigo, playerId, powerType, target, result });
    // Entregar el resultado al atacante: el sonar solo tiene sentido si el jugador VE
    // las celdas reveladas (antes el resultado solo iba a evt.game / observabilidad);
    // el bombardeo necesita el target para su animación de lanzamiento.
    await broadcastEvent(playerId, 'poder:resultado', { powerType, target, result });

    if (flotaHundida && jugador) {
      await publish('GameEnded', {
        codigo,
        winner:   jugador.equipo,
        modo:     sala.modo,
        duracion: sala.terminadoEn - (sala.iniciadoEn ?? sala.terminadoEn),
      });
      await broadcastState(codigo);
      log.info(`sala ${codigo} — victoria equipo ${jugador.equipo} (por bombardeo)`);
      return;
    }

    await broadcastState(codigo);
    log.info(`sala ${codigo} — poder ${powerType} aplicado (sin contramedida)`);
  } catch (err) {
    log.error(`error aplicando poder ${powerType} en sala ${codigo} —`, err.message);
  }
}
