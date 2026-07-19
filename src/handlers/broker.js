import { redis } from '../index.js';
import { createConsumer } from '../kafka.js';
import { log } from '../logger.js';
import { conCorrelation, correlationActual, instrumentar, trackConsumer } from '../observability.js';
import { enviarADLQ } from '../dlq.js';
import { crearBackoff } from '../backoff.js';
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
trackConsumer(consumer); // salud del consumer -> kafka_consumer_up + /health (hallazgo #1)

// Backoff exponencial + jitter para la reconexión (antes: 5s fijos → thundering herd al volver Kafka).
const reconexion = crearBackoff({ baseMs: 1000, maxMs: 30000 });
consumer.on(consumer.events.GROUP_JOIN, () => reconexion.reset()); // reconectó bien → resetea el backoff

export async function startBroker() {
  await consumer.connect();
  await consumer.subscribe({
    topics:        ['cmd.game', 'evt.room', 'evt.timer', 'evt.bot'],
    fromBeginning: false,
  });

  consumer.on(consumer.events.CRASH, async () => {
    const delay = reconexion.siguiente();
    log.warn(`kafka consumer crasheó — reconectando en ${delay}ms (intento ${reconexion.intentos})...`);
    setTimeout(async () => {
      try {
        await consumer.disconnect();
        await startBroker();
      } catch (err) {
        log.error('error al reconectar consumer —', err.message);
      }
    }, delay);
  });

  await consumer.run({
    // Procesa varias particiones EN PARALELO (antes 1 a la vez = cuello serial). Cada
    // sala vive en UNA partición (keyed por codigo) → sigue serializada; solo se
    // paralelizan salas DISTINTAS. Sube el throughput de una réplica ~Nx sin más réplicas.
    partitionsConsumedConcurrently: 6,
    eachMessage: async ({ topic, message }) => {
      const raw = message.value.toString();
      const key = message.key?.toString() ?? null;

      // El parseo va PRIMERO y aparte: un mensaje con JSON inválido (poison message) no puede
      // procesarse ni reintentarse con éxito. Antes esto lanzaba fuera del try y podía colgar
      // el consumer en un bucle; ahora va directo a la DLQ y el bucle sigue.
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        await enviarADLQ({ servicio: 'game', topicOriginal: topic, key, raw, error: err });
        return;
      }

      await conCorrelation(msg.correlationId, async () => {
        try {
          if      (topic === 'cmd.game')  await instrumentar(msg.type ?? 'cmd.game', dispatchGame)(msg);
          else if (topic === 'evt.room')  await dispatchRoom(msg);
          else if (topic === 'evt.timer') await dispatchTimer(msg);
          else if (topic === 'evt.bot')   await dispatchBot(msg);
        } catch (err) {
          // El mensaje falló su procesamiento → a la DLQ (recuperable) en vez de perderse.
          log.error(`error procesando mensaje Kafka — ${err.message} [cid=${correlationActual()}]`);
          await enviarADLQ({ servicio: 'game', topicOriginal: topic, key, raw, error: err, correlationId: correlationActual() });
        }
      });
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
    // Sin .catch aquí a propósito: si un handler crítico (disparo, salva, poder) falla, el error
    // sube al bucle de eachMessage → se registra Y se envía a la DLQ. Antes se tragaba con un
    // log y el evento se perdía silenciosamente (justo el antipatrón que cierra esta tarea).
    await handler(msg.data);
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

  // Reset de TODO el estado de juego previo. Es idempotente en una partida nueva (no había
  // nada) y CLAVE para la REVANCHA: room reusa RoomReady para reiniciar la sala, así que aquí
  // se limpian tableros/turno/salva/winner/energías de la partida anterior → arranca en blanco.
  sala.tableros           = {};
  sala.colocados          = [];
  sala.turno              = null;
  sala.salvoActual        = null;
  sala.winner             = null;
  sala.terminadoEn        = null;
  sala.escudos            = {};
  sala.tormentaUsada      = {};
  sala.contramedidaActiva = null;
  sala.turnosASaltar      = 0;
  await redis.del(`sala:${codigo}:energia:A`, `sala:${codigo}:energia:B`);

  // Modo 1v1-bot: el bot no viene de room (slot único para el humano). Lo agregamos
  // aquí como jugador del equipo B, con flota colocada automáticamente y marcado como
  // "colocado" para que la partida avance a TURNOS en cuanto el humano confirme.
  if (modo === '1v1-bot') {
    if (!sala.jugadores.some((j) => j.id === 'bot')) {
      sala.jugadores.push({ id: 'bot', name: 'Bot', equipo: 'B', conectado: true, esBot: true });
    }
    const { board } = generarFlotaAleatoria(sizeForMode(modo));
    sala.tableros['B'] = board; // tablero del EQUIPO B (el bot) — regenerado en cada partida
    sala.colocados.push('bot');
    log.info(`sala ${codigo} — bot listo con flota (modo 1v1-bot)`);
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
