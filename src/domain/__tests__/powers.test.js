import { describe, it, expect } from 'vitest';
import {
  POWER_COSTS, validatePower,
  applyBombardeo, applySonar,
  applyEscudo, teamShieldActive, consumeTeamShield,
  applyTormenta,
} from '../powers.js';
import { createBoard, placeShip } from '../board.js';
import { isFleetSunk } from '../fleet.js';

const makeSala = (overrides = {}) => ({
  fase:      'TURNOS',
  turno:     { jugadorActual: 'p1', pausado: false },
  jugadores: [{ id: 'p1', equipo: 'A' }, { id: 'p2', equipo: 'B' }],
  ...overrides,
});

describe('POWER_COSTS', () => {
  it('tiene los 5 poderes', () => {
    expect(Object.keys(POWER_COSTS)).toHaveLength(5);
  });
});

describe('validatePower', () => {
  it('pasa con energía suficiente', () => {
    expect(validatePower(makeSala(), 'p1', 'bombardeo', 5).cost).toBe(2);
  });

  it('lanza fase_incorrecta cuando no es TURNOS', () => {
    expect(() => validatePower(makeSala({ fase: 'COLOCACION' }), 'p1', 'bombardeo', 5))
      .toThrow(expect.objectContaining({ code: 'fase_incorrecta' }));
  });

  it('lanza no_es_tu_turno', () => {
    expect(() => validatePower(makeSala(), 'p2', 'bombardeo', 5))
      .toThrow(expect.objectContaining({ code: 'no_es_tu_turno' }));
  });

  it('lanza poder_invalido', () => {
    expect(() => validatePower(makeSala(), 'p1', 'super_laser', 99))
      .toThrow(expect.objectContaining({ code: 'poder_invalido' }));
  });

  it('lanza energia_insuficiente', () => {
    expect(() => validatePower(makeSala(), 'p1', 'bombardeo', 1))
      .toThrow(expect.objectContaining({ code: 'energia_insuficiente' }));
  });
});

describe('applyBombardeo', () => {
  it('impacta celdas en área 3x3', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 4, y: 4, horizontal: true });
    const r = applyBombardeo(b, 4, 4);
    expect(r.some((c) => c.x === 4 && c.y === 4 && c.hit)).toBe(true);
    expect(r.some((c) => c.x === 5 && c.y === 4 && c.hit)).toBe(true);
  });

  it('no sale del tablero en esquina (0,0)', () => {
    const b = createBoard();
    const r = applyBombardeo(b, 0, 0);
    expect(r.length).toBe(4);
    expect(r.every((c) => c.x >= 0 && c.y >= 0)).toBe(true);
  });

  it('no sale del tablero en esquina (9,9)', () => {
    const b = createBoard();
    const r = applyBombardeo(b, 9, 9);
    expect(r.length).toBe(4);
  });

  it('hundir el último barco por bombardeo deja la flota hundida (fin de partida)', () => {
    const b = createBoard();
    // Única flota restante: un destructor dentro del área 3×3 del bombardeo.
    placeShip(b, { id: 'destructor', size: 2, x: 4, y: 4, horizontal: true }); // (4,4),(5,4)
    expect(isFleetSunk(b)).toBe(false);
    applyBombardeo(b, 4, 4);
    // Ninguna celda queda como 'ship' → el handler debe terminar la partida.
    expect(isFleetSunk(b)).toBe(true);
  });
});

describe('applySonar (área 3×3)', () => {
  it('encuentra barcos dentro del 3×3 alrededor del centro', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 4, y: 5, horizontal: true }); // (4,5),(5,5)
    const found = applySonar(b, 5, 5); // centro (5,5), área 4..6 x 4..6
    expect(found).toContainEqual({ x: 4, y: 5 });
    expect(found).toContainEqual({ x: 5, y: 5 });
  });

  it('no revela barcos fuera del 3×3', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 0, y: 0, horizontal: true }); // lejos
    expect(applySonar(b, 5, 5)).toEqual([]);
  });

  it('respeta los bordes del tablero', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 0, y: 0, horizontal: true });
    const found = applySonar(b, 0, 0); // esquina: área 0..1 x 0..1
    expect(found).toContainEqual({ x: 0, y: 0 });
    expect(found).toContainEqual({ x: 1, y: 0 });
  });
});

describe('escudo de equipo (protege toda la flota)', () => {
  it('aplica un escudo al equipo', () => {
    const sala = makeSala();
    applyEscudo(sala, 'B');
    expect(teamShieldActive(sala, 'B')).toBe(true);
    expect(teamShieldActive(sala, 'A')).toBe(false);
  });

  it('se consume al bloquear un impacto', () => {
    const sala = makeSala();
    applyEscudo(sala, 'B');
    consumeTeamShield(sala, 'B');
    expect(teamShieldActive(sala, 'B')).toBe(false);
  });
});

describe('applyTormenta', () => {
  it('no cambia el turno actual pero marca un salto pendiente', () => {
    const sala = makeSala();
    applyTormenta(sala, 'p1');
    expect(sala.turno.jugadorActual).toBe('p1'); // el atacante aún dispara
    expect(sala.turnosASaltar).toBe(1);           // la próxima rotación saltará al rival
    expect(sala.tormentaUsada.p1).toBe(true);
  });

  it('lanza tormenta_ya_usada al segundo intento', () => {
    const sala = makeSala();
    applyTormenta(sala, 'p1');
    expect(() => applyTormenta(sala, 'p1'))
      .toThrow(expect.objectContaining({ code: 'tormenta_ya_usada' }));
  });
});
