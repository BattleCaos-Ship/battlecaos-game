import { DomainError } from './errors.js';

export const FASES = ['LOBBY', 'COLOCACION', 'TURNOS', 'SALVA', 'FIN'];

// presentacion.md / desarrollo.md: "cada 3 rondas" se abre una ventana de Salva.
// Una RONDA = todos los jugadores han tenido un turno. Por eso el umbral en turnos
// individuales es (rondas × nº de jugadores) — así en 1v1 la salva llega cada 6 turnos
// y en 2v2 cada 12, no cada 3 turnos sueltos (que la haría aparecer demasiado seguido).
export const SALVA_EVERY_N_ROUNDS = 3;

const TRANSICIONES = {
  LOBBY:      'COLOCACION',
  COLOCACION: 'TURNOS',
  TURNOS:     'SALVA',
  SALVA:      'TURNOS',
};

export function nextFase(faseActual) {
  const siguiente = TRANSICIONES[faseActual];
  if (!siguiente) throw new DomainError('fase_invalida', `Sin transición desde ${faseActual}`);
  return siguiente;
}

export function validateTurn(sala, playerId) {
  if (sala.fase !== 'TURNOS')
    throw new DomainError('fase_incorrecta', 'No es fase de turnos');
  if (sala.turno?.pausado)
    throw new DomainError('turno_pausado', 'Turno en pausa por desconexión');
  if (sala.turno?.jugadorActual !== playerId)
    throw new DomainError('no_es_tu_turno', 'No es tu turno');
  return true;
}

// Decide, tras cada turno, si se rota al siguiente jugador o si toca abrir Salva.
// Es pura: no toca Redis ni publica nada, solo calcula el siguiente estado de turno.
export function rotateTurn(sala) {
  const idx         = sala.jugadores.findIndex((j) => j.id === sala.turno.jugadorActual);
  const numeroTurno = (sala.turno.numeroTurno ?? 0) + 1;
  const umbralSalva = SALVA_EVERY_N_ROUNDS * sala.jugadores.length;

  if (numeroTurno % umbralSalva === 0) {
    return { startSalvo: true, numeroTurno };
  }

  // Tormenta: si hay un turno pendiente por saltar, avanzamos un jugador EXTRA (se salta el
  // rival). En 1v1 esto hace que el atacante repita turno; en 2v2 cede el turno a su compañero.
  const salto = (sala.turnosASaltar ?? 0) > 0 ? 1 : 0;
  const jugadorActual = sala.jugadores[(idx + 1 + salto) % sala.jugadores.length].id;
  return { startSalvo: false, jugadorActual, numeroTurno, consumioSalto: salto > 0 };
}
