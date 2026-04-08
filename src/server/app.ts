import Fastify from 'fastify';
import cors from '@fastify/cors';
import { IndexerManager } from '../indexer/IndexerManager';
import { registerValidatorsRoute } from './routes/validators';
import { registerHealthRoutes } from './routes/health';
import { LOG_LEVEL } from '../config';

export function buildApp(indexer: IndexerManager) {
  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      // Log format: pino-pretty in dev, raw JSON in production
      ...(process.env.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }),
    },
  });

  app.register(cors, { origin: true });

  registerHealthRoutes(app, indexer);
  registerValidatorsRoute(app, indexer);

  return app;
}
