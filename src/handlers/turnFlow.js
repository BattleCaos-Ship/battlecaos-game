import { redis } from '../index.js';
import { rotateTurn } from '../domain/engine.js';
import { publish, broadcastState } from './helpers.js';
import { log } from '../logger.js';

// battlecaos-timer (DOMF1303) aún no existe: este setTimeout local sostiene la ventana
// de Salva de 8s mientras tanto. Cuando el Timer Service esté listo, endSalvo() también
// se podrá invocar desde evt:TimerEnd — es idempotente (no-op si la sala ya no está en SALVA).
const SALVA_DURATION_MS = 8_000;
const pendingSalvoEnd = {};

export async function advanceTurn(codigo, sala) {
  const resultado = rotateTurn(sala);

  if (resultado.startSalvo) {
    sala.turno.numeroTurno   = resultado.numeroTurno;
    sala.turno.jugadorActual = null;
    sala.turno.pausado       = false;
    sala.fase                = 'SALVA';
    sala.salvoActual         = { ultimoDisparo: {} };
    await redis.set(`sala:${codigo}`, JSON.stringify(sala));
    await publish('PhaseChanged', { codigo, from: 'TURNOS', to: 'SALVA' });
    await broadcastState(codigo, sala);
    log.info(`sala ${codigo} → SALVA (turno ${resultado.numeroTurno})`);
    scheduleSalvoEnd(codigo);
    return;
  }

  sala.turno.jugadorActual = resultado.jugadorActual;
  sala.turno.rotacionId    = resultado.rotacionId; // dueño del puesto (≠ actual si lo cubre el compañero)
  sala.turno.pausado       = false;
  sala.turno.numeroTurno   = resultado.numeroTurno;
  // Si esta rotación consumió una Tormenta (saltó un rival), descontarla.
  if (resultado.consumioSalto) sala.turnosASaltar = Math.max(0, (sala.turnosASaltar ?? 0) - 1);
  await redis.set(`sala:${codigo}`, JSON.stringify(sala));

  // DOMF1301: el límite de 30s es POR turno, no uno solo para toda la fase TURNOS.
  // PhaseChanged solo se publica al entrar/salir de TURNOS, así que un disparo normal
  // (mismo fase, distinto jugador) no lo dispararía — battlecaos-timer necesita este
  // evento aparte para reiniciar su reloj de turno cada vez que cambia el jugador activo.
  await publish('TurnStarted', { codigo, jugadorActual: resultado.jugadorActual });
  await broadcastState(codigo, sala);
}

function scheduleSalvoEnd(codigo) {
  clearTimeout(pendingSalvoEnd[codigo]);
  pendingSalvoEnd[codigo] = setTimeout(() => {
    delete pendingSalvoEnd[codigo];
    endSalvo(codigo).catch((err) => log.error(`error cerrando salva ${codigo} —`, err.message));
  }, SALVA_DURATION_MS);
}

export async function endSalvo(codigo) {
  const raw = await redis.get(`sala:${codigo}`);
  if (!raw) return;
  const sala = JSON.parse(raw);
  if (sala.fase !== 'SALVA') return; // ya terminó (ej. victoria a mitad de la salva)

  clearTimeout(pendingSalvoEnd[codigo]);
  delete pendingSalvoEnd[codigo];

  sala.salvoActual = null;
  sala.fase        = 'TURNOS';
  sala.turno       = { jugadorActual: sala.jugadores[0].id, numeroTurno: (sala.turno?.numeroTurno ?? 0) + 1 };
  await redis.set(`sala:${codigo}`, JSON.stringify(sala));

  await publish('PhaseChanged', { codigo, from: 'SALVA', to: 'TURNOS' });
  await broadcastState(codigo, sala);
  log.info(`sala ${codigo} salva finalizada → TURNOS`);
}
