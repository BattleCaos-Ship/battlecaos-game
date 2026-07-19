import { redis } from '../index.js';
import { producer } from '../kafka.js';
import { correlationActual } from '../observability.js';

// TTL de las salas en Redis. Deslizante: cada broadcast (o sea, cada cambio de estado de una
// partida activa) lo renueva; una sala terminada o abandonada deja de refrescarse y expira sola
// → no se acumulan salas zombi sin límite (que agotarían la memoria de Redis).
export const SALA_TTL_SEG     = 60 * 60 * 6; // 6 h — partida activa (se refresca en cada acción).
export const SALA_FIN_TTL_SEG = 60 * 30;     // 30 min — partida terminada: se limpia pronto.

// `salaPreCargada` evita un GET extra a Redis (Upstash es remoto): los handlers que
// ya tienen la sala en memoria la pasan y ahorramos un round-trip por acción.
export async function broadcastState(codigo, salaPreCargada = null) {
  let sala = salaPreCargada;
  if (!sala) {
    const raw = await redis.get(`sala:${codigo}`);
    if (!raw) return;
    sala = JSON.parse(raw);
  }

  // UN solo round-trip: renueva el TTL de la sala y sus subclaves Y lee la energía (que vive en
  // claves aparte sala:{codigo}:energia:{equipo}). FIN → TTL corto; otra fase → TTL largo que se
  // refresca mientras se juega. Fusionar EXPIRE+MGET en un pipeline evita un round-trip por acción.
  const ttl = sala.fase === 'FIN' ? SALA_FIN_TTL_SEG : SALA_TTL_SEG;
  const res = await redis.pipeline()
    .expire(`sala:${codigo}`, ttl)
    .expire(`sala:${codigo}:energia:A`, ttl)
    .expire(`sala:${codigo}:energia:B`, ttl)
    .expire(`sala:${codigo}:chat`, ttl) // EXPIRE en clave inexistente = no-op
    .mget(`sala:${codigo}:energia:A`, `sala:${codigo}:energia:B`)
    .exec();
  // El resultado del pipeline es [[err, val], ...]; el MGET es el último.
  const [energiaA, energiaB] = res?.[res.length - 1]?.[1] ?? [null, null];

  const payload = sanitizeState(sala);
  payload.energia = { A: parseInt(energiaA ?? '0'), B: parseInt(energiaB ?? '0') };

  await producer.send({
    topic:    'gw.broadcast',
    messages: [{ key: codigo, value: JSON.stringify({
      roomId:  codigo,
      event:   'game:state',
      payload,
      correlationId: correlationActual(),
    })}],
  });
}

export async function publish(type, data) {
  await producer.send({
    topic:    'evt.game',
    messages: [{ key: data.codigo, value: JSON.stringify({
      type, source: 'game', timestamp: Date.now(), version: 1, correlationId: correlationActual(), data,
    })}],
  });
}

export async function broadcastEvent(roomId, event, payload) {
  await producer.send({
    topic:    'gw.broadcast',
    messages: [{ key: roomId, value: JSON.stringify({ roomId, event, payload, correlationId: correlationActual() }) }],
  });
}

// Envía a cada jugador humano las celdas de la flota de SU equipo (tablero compartido),
// para que dibuje su propia flota aunque no la tenga en localStorage (flota auto-colocada
// al agotarse el tiempo, o reconexión). El rival nunca recibe estas posiciones.
export async function sendOwnFleets(codigo, sala) {
  for (const j of sala.jugadores) {
    if (j.esBot) continue;
    const board = sala.tableros?.[j.equipo];
    if (!board) continue;
    const cells = Object.values(board.ships ?? {}).flat(); // [[x,y], ...]
    // `barcos` (mapa id → celdas) permite al cliente reconstruir las FORMAS y dibujar
    // los sprites de toda la flota del equipo, no solo celdas sueltas grises.
    await broadcastEvent(j.id, 'tu:flota', { cells, barcos: board.ships ?? {} });
  }
}

// Envía las celdas del tablero de UN equipo a sus miembros humanos. Se usa durante la
// COLOCACIÓN en 2v2: cuando un jugador confirma su flota, su compañero (que aún está
// colocando) la ve al instante y no se superpone. El equipo rival nunca la recibe.
export async function sendTeamFleet(codigo, sala, equipo) {
  const board = sala.tableros?.[equipo];
  if (!board) return;
  const cells = Object.values(board.ships ?? {}).flat();
  for (const j of sala.jugadores) {
    if (j.esBot || j.equipo !== equipo) continue;
    await broadcastEvent(j.id, 'tu:flota', { cells, barcos: board.ships ?? {} });
  }
}

// `extra` permite adjuntar la celda (x,y) del disparo rechazado para que el cliente limpie
// al instante su marcador "pendiente" en vez de dejarlo colgado hasta que caduque.
export async function sendError(roomId, error, extra = {}) {
  await broadcastEvent(roomId, 'game:error', { error, ...extra });
}

// ── Estado sanitizado para clientes ──────────────────────────────────────────

function sanitizeState(sala) {
  return {
    codigo:    sala.codigo,
    nombre:    sala.nombre ?? null, // nombre visible de la sala (el código es la "contraseña")
    modo:      sala.modo ?? null,
    fase:      sala.fase,
    turno:     sala.turno ?? null,
    jugadores: (sala.jugadores ?? []).map((j) => ({
      id:        j.id,
      name:      j.name,
      equipo:    j.equipo,
      conectado: j.conectado,
      esBot:     j.esBot ?? false,
    })),
    colocados:     sala.colocados ?? [],
    winner:        sala.winner ?? null,
    tormentaUsada: sala.tormentaUsada ?? {},
    // Escudo de equipo activo (protege toda la flota): { A: bool, B: bool }.
    escudos: { A: !!sala.escudos?.A, B: !!sala.escudos?.B },
    duracion:      sala.terminadoEn ? sala.terminadoEn - (sala.iniciadoEn ?? sala.terminadoEn) : null,
    contramedidaActiva: sala.contramedidaActiva
      ? {
          powerType:    sala.contramedidaActiva.powerType,
          targetEquipo: sala.contramedidaActiva.targetEquipo,
          expiraEn:     sala.contramedidaActiva.expiraEn,
        }
      : null,
    tableroPublico: buildPublicBoards(sala),
  };
}

// Tableros públicos POR EQUIPO ('A'/'B'): solo se revelan celdas hit/miss (nunca las
// posiciones de barcos). El cliente usa su equipo para saber cuál es el propio y cuál el rival.
function buildPublicBoards(sala) {
  if (!sala.tableros) return null;
  const result = {};
  for (const [equipo, board] of Object.entries(sala.tableros)) {
    const publicCells = {};
    for (const [key, val] of Object.entries(board.cells ?? {})) {
      if (val === 'hit' || val === 'miss' || val === 'sunk') publicCells[key] = val;
    }
    result[equipo] = { size: board.size, cells: publicCells };
  }
  return result;
}
