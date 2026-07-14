import { describe, it, expect } from 'vitest';
import { createBoard, placeShip, shoot, isShipSunk, sizeForMode } from '../board.js';
import { DomainError } from '../errors.js';

describe('sizeForMode', () => {
  it('1v1 y 1v1-bot usan 10', () => {
    expect(sizeForMode('1v1')).toBe(10);
    expect(sizeForMode('1v1-bot')).toBe(10);
  });
  it('2v2 usa 13', () => expect(sizeForMode('2v2')).toBe(13));
  it('modo desconocido cae a 10', () => expect(sizeForMode('otro')).toBe(10));
});

describe('createBoard', () => {
  it('crea tablero 10x10 por defecto', () => {
    const b = createBoard();
    expect(b.size).toBe(10);
    expect(b.cells).toEqual({});
    expect(b.ships).toEqual({});
  });

  it('acepta tamaño personalizado', () => {
    expect(createBoard(5).size).toBe(5);
  });
});

describe('placeShip', () => {
  it('coloca barco horizontal', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 0, y: 0, horizontal: true });
    expect(b.cells['0,0']).toBe('ship');
    expect(b.cells['1,0']).toBe('ship');
    expect(b.ships['destructor']).toEqual([[0, 0], [1, 0]]);
  });

  it('coloca barco vertical', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 3, y: 2, horizontal: false });
    expect(b.cells['3,2']).toBe('ship');
    expect(b.cells['3,3']).toBe('ship');
  });

  it('lanza fuera_de_limites', () => {
    const b = createBoard();
    expect(() => placeShip(b, { id: 'acorazado', size: 4, x: 8, y: 0, horizontal: true }))
      .toThrow(expect.objectContaining({ code: 'fuera_de_limites' }));
  });

  it('lanza celda_ocupada en solapamiento', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 0, y: 0, horizontal: true });
    expect(() => placeShip(b, { id: 'crucero', size: 3, x: 0, y: 0, horizontal: false }))
      .toThrow(expect.objectContaining({ code: 'celda_ocupada' }));
  });
});

describe('shoot', () => {
  it('impacto en celda con barco', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 3, y: 3, horizontal: true });
    const r = shoot(b, 3, 3);
    expect(r.valid).toBe(true);
    expect(r.hit).toBe(true);
    expect(r.shipId).toBe('destructor');
    expect(b.cells['3,3']).toBe('hit');
  });

  it('agua en celda vacía', () => {
    const b = createBoard();
    const r = shoot(b, 5, 5);
    expect(r.valid).toBe(true);
    expect(r.hit).toBe(false);
    expect(r.shipId).toBeNull();
    expect(b.cells['5,5']).toBe('miss');
  });

  it('valid:false en celda ya disparada', () => {
    const b = createBoard();
    shoot(b, 1, 1);
    expect(shoot(b, 1, 1).valid).toBe(false);
  });
});

describe('isShipSunk', () => {
  it('false cuando quedan celdas sin impactar', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 0, y: 0, horizontal: true });
    shoot(b, 0, 0);
    expect(isShipSunk(b, 'destructor')).toBe(false);
  });

  it('true cuando todas las celdas son hit', () => {
    const b = createBoard();
    placeShip(b, { id: 'destructor', size: 2, x: 0, y: 0, horizontal: true });
    shoot(b, 0, 0);
    shoot(b, 1, 0);
    expect(isShipSunk(b, 'destructor')).toBe(true);
  });

  it('false para shipId desconocido', () => {
    expect(isShipSunk(createBoard(), 'no_existe')).toBe(false);
  });
});
