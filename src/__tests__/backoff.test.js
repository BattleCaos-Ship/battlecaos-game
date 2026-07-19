import { describe, it, expect } from 'vitest';
import { crearBackoff } from '../backoff.js';

describe('crearBackoff', () => {
  it('crece de forma aproximadamente exponencial hasta el tope', () => {
    const b = crearBackoff({ baseMs: 1000, maxMs: 30000 });
    const d0 = b.siguiente(); // tope 1000 → [500, 1000]
    const d1 = b.siguiente(); // tope 2000 → [1000, 2000]
    const d2 = b.siguiente(); // tope 4000 → [2000, 4000]
    expect(d0).toBeGreaterThanOrEqual(500);
    expect(d0).toBeLessThanOrEqual(1000);
    expect(d1).toBeGreaterThanOrEqual(1000);
    expect(d1).toBeLessThanOrEqual(2000);
    expect(d2).toBeGreaterThanOrEqual(2000);
    expect(d2).toBeLessThanOrEqual(4000);
  });

  it('nunca excede maxMs', () => {
    const b = crearBackoff({ baseMs: 1000, maxMs: 5000 });
    for (let i = 0; i < 20; i++) {
      const d = b.siguiente();
      expect(d).toBeLessThanOrEqual(5000);
    }
  });

  it('reset() vuelve a empezar corto', () => {
    const b = crearBackoff({ baseMs: 1000, maxMs: 30000 });
    for (let i = 0; i < 5; i++) b.siguiente(); // sube el intento
    expect(b.intentos).toBe(5);
    b.reset();
    expect(b.intentos).toBe(0);
    expect(b.siguiente()).toBeLessThanOrEqual(1000); // otra vez el primer escalón
  });

  it('aplica jitter (dos backoffs independientes no siempre coinciden)', () => {
    const a = crearBackoff({ baseMs: 8000, maxMs: 30000 });
    const b = crearBackoff({ baseMs: 8000, maxMs: 30000 });
    // Con jitter en un rango de 4000ms, es prácticamente imposible que 5 pares coincidan exactos.
    let distintos = 0;
    for (let i = 0; i < 5; i++) if (a.siguiente() !== b.siguiente()) distintos++;
    expect(distintos).toBeGreaterThan(0);
  });
});
