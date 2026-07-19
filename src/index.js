import 'dotenv/config';
import { createRedis } from './redis.js';
import { producer } from './kafka.js';
import { log } from './logger.js';
import { startObservability } from './observability.js';
import { startBroker } from './handlers/broker.js';

export const redis = createRedis();
await redis.connect();

// Observabilidad (/health, /metrics) — el motor del juego es el servicio más crítico;
// aquí se exponen sus métricas de disparos, latencia y salud de Redis.
startObservability({ port: process.env.OBS_PORT ?? 9100, redis });

await producer.connect();
log.info('kafka producer conectado');

await startBroker();
log.info('game service iniciado');
