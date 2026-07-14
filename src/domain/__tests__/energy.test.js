import { describe, it, expect } from 'vitest';
import { energyGain, hasEnough } from '../energy.js';

describe('energyGain', () => {
  it('0 por agua', () => expect(energyGain(false, false)).toBe(0));
  it('1 por impacto',    () => expect(energyGain(true, false)).toBe(1));
  it('4 por hundimiento', () => expect(energyGain(true, true)).toBe(4));
});

describe('hasEnough', () => {
  it('true cuando hay suficiente', ()  => expect(hasEnough(5, 2)).toBe(true));
  it('true cuando es exacto',     ()  => expect(hasEnough(2, 2)).toBe(true));
  it('false cuando no alcanza',   ()  => expect(hasEnough(1, 2)).toBe(false));
  it('false con 0 energía',       ()  => expect(hasEnough(0, 1)).toBe(false));
});
