import { Kafka } from 'kafkajs';

const config = {
  clientId: process.env.KAFKA_CLIENT_ID ?? 'battlecaos-game',
  brokers:  (process.env.KAFKA_BROKER ?? 'localhost:9092').split(',').map((b) => b.trim()), // acepta lista: b1:9092,b2:9093
  // Timeouts explícitos (disponibilidad §10): no esperar indefinidamente a un broker lento/caído.
  connectionTimeout: 3000,  // conectar al broker
  requestTimeout:    30000, // una petición al broker
  // Retry con backoff EXPONENCIAL del cliente (KafkaJS lo aplica a peticiones fallidas). Explícito
  // para dejar la intención clara; complementa el backoff de reconexión del consumer (backoff.js).
  retry: { initialRetryTime: 300, factor: 2, retries: 8 },
};

if (process.env.KAFKA_USERNAME) {
  config.ssl  = true;
  config.sasl = {
    mechanism: 'scram-sha-256',
    username:  process.env.KAFKA_USERNAME,
    password:  process.env.KAFKA_PASSWORD,
  };
}

const kafka = new Kafka(config);

export const producer      = kafka.producer();
export const createConsumer = (groupId) => kafka.consumer({ groupId });
