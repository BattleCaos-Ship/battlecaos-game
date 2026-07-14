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
    expect(r).toEqual({ startSalvo: false, jugadorActual: 'p2', numeroTurno: 1, consumioSalto: false });
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
});
