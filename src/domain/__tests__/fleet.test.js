import { describe, it, expect } from 'vitest';
import { FLEET_CONFIG, validateFleet, isFleetSunk } from '../fleet.js';
import { createBoard, placeShip, shoot } from '../board.js';

describe('validateFleet', () => {
  const validShips = () => FLEET_CONFIG.map((s) => ({ ...s, x: 0, y: 0, horizontal: true }));

  it('acepta flota válida', () => {
    expect(() => validateFleet(validShips())).not.toThrow();
  });

  it('lanza flota_incompleta con 0 barcos', () => {
    expect(() => validateFleet([]))
      .toThrow(expect.objectContaining({ code: 'flota_incompleta' }));
  });

  it('lanza flota_incompleta con demasiados barcos', () => {
    const extra = [...validShips(), { id: 'extra', size: 1, x: 0, y: 0, horizontal: true }];
    expect(() => validateFleet(extra))
      .toThrow(expect.objectContaining({ code: 'flota_incompleta' }));
  });

  it('lanza barcos_incorrectos con ID incorrecto', () => {
    const ships = validShips();
    ships[0] = { ...ships[0], id: 'barco_falso' };
    expect(() => validateFleet(ships))
      .toThrow(expect.objectContaining({ code: 'barcos_incorrectos' }));
  });

  it('lanza tamano_incorrecto con tamaño erróneo', () => {
    const ships = validShips();
    ships[0] = { ...ships[0], size: 99 };
    expect(() => validateFleet(ships))
      .toThrow(expect.objectContaining({ code: 'tamano_incorrecto' }));
  });
});

describe('isFleetSunk', () => {
  it('false cuando quedan barcos', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 0, y: 0, horizontal: true });
    expect(isFleetSunk(b)).toBe(false);
  });

  it('true cuando no quedan barcos', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 0, y: 0, horizontal: true });
    shoot(b, 0, 0);
    shoot(b, 1, 0);
    expect(isFleetSunk(b)).toBe(true);
  });

  it('true en tablero vacío', () => {
    expect(isFleetSunk(createBoard())).toBe(true);
  });
});
