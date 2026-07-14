import 'dotenv/config';
import { createRedis } from './redis.js';
import { producer } from './kafka.js';
import { log } from './logger.js';
import { startBroker } from './handlers/broker.js';

export const redis = createRedis();
await redis.connect();

await producer.connect();
log.info('kafka producer conectado');

await startBroker();
log.info('game service iniciado');
