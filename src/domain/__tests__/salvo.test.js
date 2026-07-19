import { describe, it, expect } from 'vitest';
import { canFireInSalvo, registerShot, SALVO_CADENCIA_MS, SALVO_CADENCIA_TOLERANCIA_MS } from '../salvo.js';

// Umbral efectivo tras aplicar la tolerancia de jitter.
const GATE = SALVO_CADENCIA_MS - SALVO_CADENCIA_TOLERANCIA_MS;

describe('canFireInSalvo', () => {
  it('permite el primer disparo del jugador', () => {
    expect(canFireInSalvo({ ultimoDisparo: {} }, 'p1')).toBe(true);
  });

  it('rechaza un segundo disparo antes del umbral (con tolerancia)', () => {
    const state = { ultimoDisparo: { p1: 1000 } };
    expect(canFireInSalvo(state, 'p1', 1000 + GATE - 1)).toBe(false);
  });

  it('permite disparar de nuevo al cumplirse el umbral', () => {
    const state = { ultimoDisparo: { p1: 1000 } };
    expect(canFireInSalvo(state, 'p1', 1000 + GATE)).toBe(true);
  });

  it('no bloquea a otros jugadores por la cadencia de uno solo', () => {
    const state = { ultimoDisparo: { p1: 1000 } };
    expect(canFireInSalvo(state, 'p2', 1000)).toBe(true);
  });
});

describe('registerShot', () => {
  it('actualiza el timestamp del último disparo del jugador', () => {
    const state = { ultimoDisparo: {} };
    registerShot(state, 'p1', 5000);
    expect(state.ultimoDisparo.p1).toBe(5000);
  });
});
