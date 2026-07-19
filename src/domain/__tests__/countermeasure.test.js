import { describe, it, expect } from 'vitest';
import { COUNTERABLE_POWERS, canCountermeasure, isWindowExpired } from '../countermeasure.js';

const makeSala = (contramedidaActiva) => ({
  jugadores: [{ id: 'p1', equipo: 'A' }, { id: 'p2', equipo: 'B' }],
  contramedidaActiva,
});

describe('COUNTERABLE_POWERS', () => {
  it('solo bombardeo y sonar son contrarrestables', () => {
    expect(COUNTERABLE_POWERS).toEqual(['bombardeo', 'sonar']);
  });
});

describe('canCountermeasure', () => {
  it('permite al equipo objetivo contrarrestar un poder ofensivo activo', () => {
    const sala = makeSala({ powerType: 'bombardeo', targetEquipo: 'B', expiraEn: Date.now() + 5000 });
    expect(canCountermeasure(sala, 'p2')).toBe(true);
  });

  it('rechaza si no hay contramedida activa', () => {
    expect(canCountermeasure(makeSala(null), 'p2')).toBe(false);
  });

  it('rechaza al jugador que no pertenece al equipo objetivo', () => {
    const sala = makeSala({ powerType: 'bombardeo', targetEquipo: 'B', expiraEn: Date.now() + 5000 });
    expect(canCountermeasure(sala, 'p1')).toBe(false);
  });

  it('rechaza jugadores que no existen en la sala', () => {
    const sala = makeSala({ powerType: 'bombardeo', targetEquipo: 'B', expiraEn: Date.now() + 5000 });
    expect(canCountermeasure(sala, 'fantasma')).toBe(false);
  });

  it('rechaza poderes no contrarrestables (ej. escudo, tormenta)', () => {
    const sala = makeSala({ powerType: 'escudo', targetEquipo: 'B', expiraEn: Date.now() + 5000 });
    expect(canCountermeasure(sala, 'p2')).toBe(false);
  });
});

describe('isWindowExpired', () => {
  it('detecta ventana vigente', () => {
    expect(isWindowExpired({ expiraEn: Date.now() + 1000 })).toBe(false);
  });

  it('detecta ventana expirada', () => {
    expect(isWindowExpired({ expiraEn: Date.now() - 1 })).toBe(true);
  });
});
