import { describe, it, expect } from 'vitest';
import { conLockSala } from '../lock.js';

// Redis simulado con semántica SET NX PX real (un solo dueño a la vez).
function fakeRedis() {
  const store = new Map();
  return {
    store,
    async set(key, val, nx, px, ms) {
      if (nx === 'NX' && store.has(key)) return null; // ya tomado
      store.set(key, val);
      if (px === 'PX') setTimeout(() => { if (store.get(key) === val) store.delete(key); }, ms);
      return 'OK';
    },
    async get(key) { return store.get(key) ?? null; },
    async del(key) { store.delete(key); return 1; },
  };
}

describe('conLockSala', () => {
  it('ejecuta la función y libera el lock', async () => {
    const r = fakeRedis();
    const res = await conLockSala(r, '123456', async () => 'hecho');
    expect(res).toBe('hecho');
    expect(r.store.has('lock:sala:123456')).toBe(false); // liberado
  });

  it('serializa: dos operaciones sobre la misma sala no se solapan', async () => {
    const r = fakeRedis();
    const orden = [];
    const op = (id) => conLockSala(r, 'AAA', async () => {
      orden.push(`${id}-inicio`);
      await new Promise((res) => setTimeout(res, 15));
      orden.push(`${id}-fin`);
    }, { esperaMs: 5 });
    await Promise.all([op('a'), op('b')]);
    // Cada operación termina antes de que empiece la otra (no se intercalan inicio/inicio).
    const a = orden.indexOf('a-fin'), b = orden.indexOf('b-fin');
    const aStart = orden.indexOf('a-inicio'), bStart = orden.indexOf('b-inicio');
    const primeroTermina = a < b ? a : b;
    const segundoEmpieza = a < b ? bStart : aStart;
    expect(segundoEmpieza).toBeGreaterThan(primeroTermina); // el 2º empezó tras el 1º terminar
  });

  it('no libera un lock que ya no es suyo (token distinto)', async () => {
    const r = fakeRedis();
    // Simular que durante fn el lock expiró y otro lo tomó con OTRO token.
    await conLockSala(r, 'BBB', async () => {
      r.store.set('lock:sala:BBB', 'token-de-otro');
    });
    expect(r.store.get('lock:sala:BBB')).toBe('token-de-otro'); // no se lo quitamos
  });

  it('procesa igual si nunca consigue el lock (no pierde el evento)', async () => {
    const r = fakeRedis();
    r.store.set('lock:sala:CCC', 'ocupado-por-siempre'); // nadie lo suelta
    let ejecutado = false;
    await conLockSala(r, 'CCC', async () => { ejecutado = true; }, { reintentos: 2, esperaMs: 2 });
    expect(ejecutado).toBe(true); // se ejecutó de todos modos
  });
});
