import { redis } from '../index.js';
import { createConsumer } from '../kafka.js';
import { log } from '../logger.js';
import { broadcastState, publish, sendOwnFleets } from './helpers.js';
import { handlePlaceShips }      from './handlePlaceShips.js';
import { handleShot }            from './handleShot.js';
import { handleSalvo }           from './handleSalvo.js';
import { handlePower }           from './handlePower.js';
import { handleCountermeasure }  from './handleCountermeasure.js';
import { handleDisconnect, handleReconnect } from './handleDisconnect.js';
import { advanceTurn, endSalvo } from './turnFlow.js';
import { generarFlotaAleatoria } from '../domain/autoFleet.js';
import { sizeForMode } from '../domain/board.js';

const consumer = createConsumer('game-group');

export async function startBroker() {
  await consumer.connect();
  await consumer.subscribe({
    topics:        ['cmd.game', 'evt.room', 'evt.timer', 'evt.bot'],
    fromBeginning: false,
  });

  consumer.on(consumer.events.CRASH, async () => {
    log.warn('kafka consumer crasheó — reconectando en 5s...');
    setTimeout(async () => {
      try {
        await consumer.disconnect();
        await startBroker();
      } catch (err) {
        log.error('error al reconectar consumer —', err.message);
      }
    }, 5000);
  });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const msg = JSON.parse(message.value.toString());
        if      (topic === 'cmd.game')  await dispatchGame(msg);
        else if (topic === 'evt.room')  await dispatchRoom(msg);
        else if (topic === 'evt.timer') await dispatchTimer(msg);
        else if (topic === 'evt.bot')   await dispatchBot(msg);
      } catch (err) {
        log.error('error procesando mensaje Kafka —', err.message);
      }
    },
  });

  log.info('kafka consumer listo — cmd.game, evt.room, evt.timer, evt.bot');
}

// ── Dispatchers por topic ─────────────────────────────────────────────────────

const GAME_HANDLERS = {
  'colocacion:set':       handlePlaceShips,
  'disparo:realizar':     handleShot,
  'salva:disparo':        handleSalvo,
  'poder:usar':           handlePower,
  'contramedida:activar': handleCountermeasure,
};

async function dispatchGame(msg) {
  const handler = GAME_HANDLERS[msg.type];
  if (handler) {
    await handler(msg.data).catch((err) => log.error(`error en ${msg.type} —`, err.message));
  }
}

async function dispatchRoom(msg) {
  if (msg.type === 'RoomReady') {
    await handleRoomReady(msg.data);
  } else if (msg.type === 'PlayerDisconnectedFromRoom') {
    await handleDisconnect(msg.data).catch((err) => log.error('error handleDisconnect —', err.message));
  } else if (msg.type === 'PlayerReconnected') {
    await handleReconnect(msg.data).catch((err) => log.error('error handleReconnect —', err.message));
  }
}

async function dispatchTimer(msg) {
  if (msg.type === 'TimerEnd') {
    await handleTimerEnd(msg.data).catch((err) => log.error('error handleTimerEnd —', err.message));
  }
}

async function dispatchBot(msg) {
  if (msg.type === 'BotDecision') {
    await handleShot(msg.data).catch((err) => log.error('error disparo bot —', err.message));
  } else if (msg.type === 'BotPower') {
    await handlePower(msg.data).catch((err) => log.error('error poder bot —', err.message));
  }
}

// ── Lógica interna del broker ─────────────────────────────────────────────────

async function handleRoomReady({ codigo, modo, jugadores }) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) {
    log.warn(`RoomReady: sala ${codigo} no existe en Redis`);
    return;
  }
  const sala = JSON.parse(raw);
  sala.fase       = 'COLOCACION';
  sala.iniciadoEn = Date.now();

  // Modo 1v1-bot: el bot no viene de room (slot único para el humano). Lo agregamos
  // aquí como jugador del equipo B, con flota colocada automáticamente y marcado como
  // "colocado" para que la partida avance a TURNOS en cuanto el humano confirme.
  if (modo === '1v1-bot' && !sala.jugadores.some((j) => j.id === 'bot')) {
    const { board } = generarFlotaAleatoria(sizeForMode(modo));
    sala.jugadores.push({ id: 'bot', name: 'Bot', equipo: 'B', conectado: true, esBot: true });
    sala.tableros ??= {};
    sala.tableros['B'] = board; // tablero del EQUIPO B (el bot)
    sala.colocados ??= [];
    if (!sala.colocados.includes('bot')) sala.colocados.push('bot');
    log.info(`sala ${codigo} — bot agregado con flota (modo 1v1-bot)`);
  }

  await redis.set(`sala:${codigo}`, JSON.stringify(sala));

  await publish('GameStarted', { codigo, modo });
  await broadcastState(codigo);
  log.info(`sala ${codigo} → COLOCACION`);
}

async function handleTimerEnd({ codigo, tipo }) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);

  if (tipo === 'COLOCACION' && sala.fase === 'COLOCACION') {
    // Auto-colocar una flota aleatoria para CADA equipo que no alcanzó a colocar. Sin esto,
    // avanzar a TURNOS sin tablero deja el juego roto (el rival dispara a un tablero
    // inexistente y se cuelga). Así la partida siempre es jugable aunque el tiempo se acabe.
    sala.tableros ??= {};
    sala.colocados ??= [];
    const equipos = [...new Set(sala.jugadores.map((j) => j.equipo))];
    let autoColocados = 0;
    for (const eq of equipos) {
      if (!sala.tableros[eq]) {
        const { board } = generarFlotaAleatoria(sizeForMode(sala.modo));
        sala.tableros[eq] = board;
        autoColocados++;
      }
    }
    for (const j of sala.jugadores) {
      if (!sala.colocados.includes(j.id)) sala.colocados.push(j.id);
    }

    sala.fase  = 'TURNOS';
    sala.turno = { jugadorActual: sala.jugadores[0].id, numeroTurno: 1 };
    await redis.set(`sala:${codigo}`, JSON.stringify(sala));
    await publish('PhaseChanged', { codigo, from: 'COLOCACION', to: 'TURNOS' });
    await sendOwnFleets(codigo, sala); // cada jugador ve su flota (incl. las auto-colocadas)
    await broadcastState(codigo);
    log.info(`sala ${codigo} → TURNOS (timer colocación, ${autoColocados} flota(s) auto-colocada(s))`);

  } else if (tipo === 'TURNO' && sala.fase === 'TURNOS') {
    await advanceTurn(codigo, sala);
    log.info(`sala ${codigo} turno rotado (timer turno)`);

  } else if (tipo === 'SALVA' && sala.fase === 'SALVA') {
    // Respaldo por si battlecaos-timer ya está publicando TimerEnd — endSalvo() es
    // idempotente con el setTimeout local de turnFlow.js (no-op si ya no está en SALVA).
    await endSalvo(codigo);
  }
}
