import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del producer de Kafka y del logger ANTES de importar dlq.js (que los usa a nivel módulo).
const enviados = [];
let fallarSend = false;

vi.mock('../kafka.js', () => ({
  producer: {
    async send(payload) {
      if (fallarSend) throw new Error('kafka caído');
      enviados.push(payload);
      return [{}];
    },
  },
}));
vi.mock('../logger.js', () => ({
  log: { warn: () => {}, error: () => {} },
}));

const { enviarADLQ } = await import('../dlq.js');

describe('enviarADLQ', () => {
  beforeEach(() => { enviados.length = 0; fallarSend = false; });

  it('republica el mensaje fallido al topic dlq con el error y el original', async () => {
    await enviarADLQ({
      servicio: 'game', topicOriginal: 'cmd.game', key: 'ABC123',
      raw: '{"type":"disparo:realizar"}', error: new Error('boom'), correlationId: 'cid-1',
    });

    expect(enviados).toHaveLength(1);
    expect(enviados[0].topic).toBe('dlq');
    const m = enviados[0].messages[0];
    expect(m.key).toBe('ABC123');
    const body = JSON.parse(m.value);
    expect(body.servicio).toBe('game');
    expect(body.topicOriginal).toBe('cmd.game');
    expect(body.error).toBe('boom');
    expect(body.correlationId).toBe('cid-1');
    expect(body.original).toBe('{"type":"disparo:realizar"}'); // crudo, listo para reprocesar
    expect(typeof body.fallidoEn).toBe('number');
  });

  it('NO lanza si hasta Kafka está caído (no debe romper el bucle del consumer)', async () => {
    fallarSend = true;
    await expect(
      enviarADLQ({ servicio: 'game', topicOriginal: 'cmd.game', raw: '{}', error: new Error('x') }),
    ).resolves.toBeUndefined();
    expect(enviados).toHaveLength(0);
  });

  it('acepta error como string y key nula sin romper', async () => {
    await enviarADLQ({ servicio: 'game', topicOriginal: 'evt.timer', raw: 'no-json', error: 'texto plano' });
    const body = JSON.parse(enviados[0].messages[0].value);
    expect(body.error).toBe('texto plano');
    expect(enviados[0].messages[0].key).toBe(null);
  });
});
