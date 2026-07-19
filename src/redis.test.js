import { describe, it, expect } from 'vitest';
import { makeResilient, esErrorDeConexion } from './redis.js';

// Cliente Redis simulado con su propio almacén; `down=true` simula caída (error de conexión).
function fakeRedis() {
  return {
    store: {},
    down: false,
    _chk() { if (this.down) throw new Error('Connection is closed'); },
    async get(k)    { this._chk(); return this.store[k] ?? null; },
    async set(k, v) { this._chk(); this.store[k] = v; return 'OK'; },
    async incr(k)   { this._chk(); this.store[k] = String((parseInt(this.store[k] || '0')) + 1); return parseInt(this.store[k]); },
    async ping()    { this._chk(); return 'PONG'; },
    async disconnect() {},
  };
}

// healthMs enorme para que el health-check no dispare durante el test.
const wrap = (p, s) => makeResilient(p, s, { healthMs: 1e9 });
// La réplica al secundario es en segundo plano: deja correr los microtasks pendientes.
const flush = () => new Promise((res) => setTimeout(res, 0));

describe('makeResilient (escritura rápida + réplica + failover)', () => {
  it('las ESCRITURAS confirman con el primario y REPLICAN al secundario', async () => {
    const p = fakeRedis(), s = fakeRedis();
    const r = wrap(p, s);
    await r.set('sala:1', 'X');
    expect(p.store['sala:1']).toBe('X'); // confirmado con el primario (ruta rápida)
    await flush();
    expect(s.store['sala:1']).toBe('X'); // replicado al respaldo en segundo plano
    await r.disconnect();
  });

  it('las LECTURAS se sirven del primario', async () => {
    const p = fakeRedis(), s = fakeRedis();
    p.store['k'] = 'delPrimario'; s.store['k'] = 'delRespaldo';
    const r = wrap(p, s);
    expect(await r.get('k')).toBe('delPrimario');
    await r.disconnect();
  });

  it('si el PRIMARIO cae, la lectura cae al respaldo (que tiene los datos por doble escritura)', async () => {
    const p = fakeRedis(), s = fakeRedis();
    const r = wrap(p, s);
    await r.set('sala:1', 'estado');   // escrito en ambos
    p.down = true;                     // se cae el primario
    expect(await r.get('sala:1')).toBe('estado'); // sigue disponible desde el respaldo
    await r.disconnect();
  });

  it('con el PRIMARIO caído, la escritura NO falla (usa solo el respaldo)', async () => {
    const p = fakeRedis(), s = fakeRedis();
    const r = wrap(p, s);
    p.down = true;
    await expect(r.set('sala:2', 'Y')).resolves.toBe('OK');
    expect(s.store['sala:2']).toBe('Y');
    await r.disconnect();
  });

  it('si AMBOS nodos caen, la escritura lanza error', async () => {
    const p = fakeRedis(), s = fakeRedis();
    const r = wrap(p, s);
    p.down = true; s.down = true;
    await expect(r.set('sala:3', 'Z')).rejects.toThrow();
    await r.disconnect();
  });

  it('esErrorDeConexion distingue errores de conexión de errores reales', () => {
    expect(esErrorDeConexion(new Error('Connection is closed'))).toBe(true);
    expect(esErrorDeConexion(new Error('ECONNREFUSED'))).toBe(true);
    expect(esErrorDeConexion(new Error('WRONGTYPE Operation against a key'))).toBe(false);
  });

  // Hallazgo del chaos test: la cuota agotada (Upstash) debe tratarse como nodo INUTILIZABLE.
  it('errores de CUOTA/CAPACIDAD cuentan como nodo caído (disparan failover)', () => {
    expect(esErrorDeConexion(new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500000'))).toBe(true);
    expect(esErrorDeConexion(new Error('OOM command not allowed when used memory > maxmemory'))).toBe(true);
  });

  it('si el PRIMARIO agota su cuota, la escritura CONMUTA al respaldo (no falla al caller)', async () => {
    const p = fakeRedis(), s = fakeRedis();
    p.set = async () => { throw new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500000'); };
    const r = wrap(p, s);
    await expect(r.set('sala:7', 'V')).resolves.toBe('OK'); // failover, no error
    expect(s.store['sala:7']).toBe('V');
    await r.disconnect();
  });

  it('si el RESPALDO agota su cuota, queda marcado caído (la divergencia deja de ser silenciosa)', async () => {
    const p = fakeRedis(), s = fakeRedis();
    let intentosAlRespaldo = 0;
    s.set = async () => { intentosAlRespaldo++; throw new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500000'); };
    const r = wrap(p, s);
    await r.set('k1', 'a'); await flush(); // 1ª escritura: replica falla → respaldo marcado caído
    await r.set('k2', 'b'); await flush(); // 2ª: ya NO se intenta replicar (salud.s = false)
    expect(intentosAlRespaldo).toBe(1);    // la divergencia se DETECTÓ, no siguió en silencio
    expect(p.store['k2']).toBe('b');       // el primario sigue operando normal
    await r.disconnect();
  });
});

describe('makeResilient con RÉPLICA de lectura (opt-in)', () => {
  const wrapR = (p, s, r) => makeResilient(p, s, { healthMs: 1e9, replica: r });

  it('las LECTURAS se sirven de la RÉPLICA cuando está presente y sana', async () => {
    const p = fakeRedis(), s = fakeRedis(), rep = fakeRedis();
    p.store['k'] = 'delPrimario'; rep.store['k'] = 'delReplica';
    const r = wrapR(p, s, rep);
    expect(await r.get('k')).toBe('delReplica'); // descarga al primario
    await r.disconnect();
  });

  it('las ESCRITURAS NUNCA van a la réplica (solo primario + respaldo)', async () => {
    const p = fakeRedis(), s = fakeRedis(), rep = fakeRedis();
    const r = wrapR(p, s, rep);
    await r.set('sala:9', 'W');
    await flush();
    expect(p.store['sala:9']).toBe('W');
    expect(s.store['sala:9']).toBe('W');
    expect(rep.store['sala:9']).toBeUndefined(); // la réplica es SOLO lectura
    await r.disconnect();
  });

  it('si la RÉPLICA cae, la lectura cae al primario', async () => {
    const p = fakeRedis(), s = fakeRedis(), rep = fakeRedis();
    p.store['k'] = 'delPrimario'; rep.store['k'] = 'delReplica';
    const r = wrapR(p, s, rep);
    rep.down = true;
    expect(await r.get('k')).toBe('delPrimario'); // fallback correcto
    await r.disconnect();
  });

  it('sin réplica, el comportamiento es idéntico al anterior (lee del primario)', async () => {
    const p = fakeRedis(), s = fakeRedis();
    p.store['k'] = 'primario';
    const r = makeResilient(p, s, { healthMs: 1e9 }); // replica no definida
    expect(await r.get('k')).toBe('primario');
    await r.disconnect();
  });
});
