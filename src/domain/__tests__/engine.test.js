import { describe, it, expect } from 'vitest';
import { FASES, nextFase, validateTurn, rotateTurn, SALVA_EVERY_N_ROUNDS } from '../engine.js';
import { DomainError } from '../errors.js';

describe('FASES', () => {
  it('contiene las 5 fases', () => {
    expect(FASES).toEqual(expect.arrayContaining(['LOBBY', 'COLOCACION', 'TURNOS', 'SALVA', 'FIN']));
  });
});

describe('nextFase', () => {
  it('LOBBY → COLOCACION', () => expect(nextFase('LOBBY')).toBe('COLOCACION'));
  it('COLOCACION → TURNOS', () => expect(nextFase('COLOCACION')).toBe('TURNOS'));
  it('TURNOS → SALVA',      () => expect(nextFase('TURNOS')).toBe('SALVA'));
  it('SALVA → TURNOS',      () => expect(nextFase('SALVA')).toBe('TURNOS'));

  it('FIN lanza DomainError', () => {
    expect(() => nextFase('FIN'))
      .toThrow(expect.objectContaining({ code: 'fase_invalida' }));
  });

  it('fase desconocida lanza DomainError', () => {
    expect(() => nextFase('INEXISTENTE'))
      .toThrow(DomainError);
  });
});

describe('validateTurn', () => {
  const sala = {
    fase:  'TURNOS',
    turno: { jugadorActual: 'p1', pausado: false },
  };

  it('pasa cuando es el turno correcto', () => {
    expect(validateTurn(sala, 'p1')).toBe(true);
  });

  it('lanza no_es_tu_turno', () => {
    expect(() => validateTurn(sala, 'p2'))
      .toThrow(expect.objectContaining({ code: 'no_es_tu_turno' }));
  });

  it('lanza fase_incorrecta cuando no es TURNOS', () => {
    expect(() => validateTurn({ ...sala, fase: 'COLOCACION' }, 'p1'))
      .toThrow(expect.objectContaining({ code: 'fase_incorrecta' }));
  });

  it('lanza turno_pausado', () => {
    const salaPausada = { fase: 'TURNOS', turno: { jugadorActual: 'p1', pausado: true } };
    expect(() => validateTurn(salaPausada, 'p1'))
      .toThrow(expect.objectContaining({ code: 'turno_pausado' }));
  });
});

describe('rotateTurn', () => {
  const makeSala = (numeroTurno, jugadorActual = 'p1') => ({
    jugadores: [{ id: 'p1' }, { id: 'p2' }],
    turno: { jugadorActual, numeroTurno },
  });

  // Con 2 jugadores, el umbral de salva es SALVA_EVERY_N_ROUNDS * 2 = 6 turnos.
  const umbral = SALVA_EVERY_N_ROUNDS * 2;

  it('rota al siguiente jugador cuando no toca Salva', () => {
    const r = rotateTurn(makeSala(0));
    expect(r).toEqual({ startSalvo: false, jugadorActual: 'p2', rotacionId: 'p2', numeroTurno: 1, consumioSalto: false });
  });

  it('con Tormenta (turnosASaltar) salta al rival: en 1v1 el atacante repite', () => {
    const sala = { ...makeSala(0, 'p1'), turnosASaltar: 1 };
    const r = rotateTurn(sala);
    expect(r.jugadorActual).toBe('p1');   // salta a p2 → vuelve a p1
    expect(r.consumioSalto).toBe(true);
  });

  it(`abre Salva cada ${SALVA_EVERY_N_ROUNDS} rondas (= ${umbral} turnos en 1v1)`, () => {
    const r = rotateTurn(makeSala(umbral - 1));
    expect(r).toEqual({ startSalvo: true, numeroTurno: umbral });
  });

  it('no abre Salva en turnos intermedios', () => {
    const r = rotateTurn(makeSala(3, 'p2'));
    expect(r.startSalvo).toBe(false);
    expect(r.numeroTurno).toBe(4);
  });

  // 2v2 con desconexión: rotación [a1, b1, a2, b2].
  const sala2v2 = (jugadorActual, patch = {}) => ({
    jugadores: [
      { id: 'a1', equipo: 'A', conectado: true },
      { id: 'b1', equipo: 'B', conectado: true },
      { id: 'a2', equipo: 'A', conectado: true },
      { id: 'b2', equipo: 'B', conectado: true },
    ].map((j) => ({ ...j, ...(patch[j.id] ?? {}) })),
    turno: { jugadorActual, numeroTurno: 0 },
  });

  it('si el siguiente está desconectado, su compañero conectado lo cubre (doble turno)', () => {
    const s = sala2v2('b1', { a2: { conectado: false } }); // sigue a2, pero está caído
    const r = rotateTurn(s);
    expect(r.jugadorActual).toBe('a1'); // el compañero de a2 lo cubre
    expect(r.rotacionId).toBe('a2');    // pero el PUESTO sigue siendo de a2
  });

  it('tras cubrir un turno, la rotación continúa desde el puesto del caído (no del sustituto)', () => {
    // a1 acaba de cubrir el puesto de a2 (jugadorActual=a1, rotacionId=a2).
    const s = sala2v2('a1', { a2: { conectado: false } });
    s.turno.rotacionId = 'a2';
    const r = rotateTurn(s);
    expect(r.jugadorActual).toBe('b2'); // sigue el puesto DESPUÉS de a2 → b2 (no b1)
  });

  it('si TODO el equipo está desconectado, pasa al siguiente en la rotación', () => {
    const s = sala2v2('b1', { a1: { conectado: false }, a2: { conectado: false } });
    const r = rotateTurn(s);
    expect(r.jugadorActual).toBe('b2'); // nadie de A disponible → sigue b2
  });

  it('jugadores sin flag conectado (salas viejas) rotan normal', () => {
    const r = rotateTurn(makeSala(0)); // makeSala no define `conectado`
    expect(r.jugadorActual).toBe('p2');
  });
});
