import { redis } from '../index.js';
import { broadcastState, publish } from './helpers.js';
import { advanceTurn } from './turnFlow.js';
import { log } from '../logger.js';

const DISCONNECT_TIMEOUT_MS = 60_000;
const pendingTimeouts = {};

export async function handleDisconnect({ codigo, playerId }) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);
  if (sala.fase === 'FIN') return;

  const esSuTurno = sala.turno?.jugadorActual === playerId;
  if (esSuTurno) {
    // 2v2: si tiene un compañero conectado, este CUBRE el turno de inmediato (doble
    // turno del compañero) en vez de pausar la partida 60s esperando la reconexión.
    const jugador   = sala.jugadores.find((j) => j.id === playerId);
    const companero = jugador && sala.jugadores.find(
      (j) => j.equipo === jugador.equipo && j.id !== playerId && (j.esBot || j.conectado !== false),
    );
    if (companero) {
      // El puesto en la rotación sigue siendo del caído (o de quien ya cubría).
      sala.turno.rotacionId    = sala.turno.rotacionId ?? playerId;
      sala.turno.jugadorActual = companero.id;
      sala.turno.pausado       = false;
      sala.turno.pausadoPor    = null;
      await redis.set(`sala:${codigo}`, JSON.stringify(sala));
      await publish('TurnStarted', { codigo, jugadorActual: companero.id }); // el timer reinicia su reloj
      await broadcastState(codigo, sala);
      log.info(`sala ${codigo} — ${playerId} desconectado en su turno, lo cubre ${companero.id}`);
      return;
    }
    sala.turno.pausado    = true;
    sala.turno.pausadoPor = playerId;
    await redis.set(`sala:${codigo}`, JSON.stringify(sala));
    await broadcastState(codigo);
  }

  // Timeout de abandono: si no reconecta en 60s, rotar turno
  const key = `${codigo}:${playerId}`;
  clearTimeout(pendingTimeouts[key]);
  pendingTimeouts[key] = setTimeout(async () => {
    delete pendingTimeouts[key];
    try {
      const raw2 = await redis.get(`sala:${codigo}`);
      if (!raw2) return;
      const salaActual = JSON.parse(raw2);
      if (salaActual.fase === 'FIN') return;

      const jugador = salaActual.jugadores.find((j) => j.id === playerId);
      if (jugador?.conectado) return; // reconectó a tiempo

      if (salaActual.turno?.pausadoPor === playerId) {
        salaActual.turno.pausadoPor = null; // advanceTurn ya limpia pausado y calcula el siguiente jugador
        await advanceTurn(codigo, salaActual);
        log.info(`sala ${codigo} — timeout ${playerId}, turno rotado`);
      }
    } catch (err) {
      log.error(`error en timeout desconexión ${codigo}:${playerId} —`, err.message);
    }
  }, DISCONNECT_TIMEOUT_MS);

  log.info(`sala ${codigo} — ${playerId} desconectado, turno pausado: ${esSuTurno}`);
}

export async function handleReconnect({ codigo, playerId }) {
  const key = `${codigo}:${playerId}`;
  if (pendingTimeouts[key]) {
    clearTimeout(pendingTimeouts[key]);
    delete pendingTimeouts[key];
  }

  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);

  if (sala.turno?.pausadoPor === playerId) {
    sala.turno.pausado    = false;
    sala.turno.pausadoPor = null;
    await redis.set(`sala:${codigo}`, JSON.stringify(sala));
    await broadcastState(codigo);
    log.info(`sala ${codigo} — ${playerId} reconectó, turno reanudado`);
  }
}
