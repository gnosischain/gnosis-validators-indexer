import { FastifyInstance } from 'fastify';
import { IndexerManager } from '../../indexer/IndexerManager';
import { apiKeyHook } from '../middleware/apiKey';

interface QueryBody {
  withdrawal_address: string;
  limit?: number;
  offset?: number;
}

export function registerValidatorsRoute(
  app: FastifyInstance,
  indexer: IndexerManager,
): void {
  app.post<{ Body: QueryBody }>(
    '/',
    {
      preHandler: apiKeyHook,
      schema: {
        body: {
          type: 'object',
          required: ['withdrawal_address'],
          properties: {
            withdrawal_address: { type: 'string', minLength: 42, maxLength: 42 },
            limit: { type: 'integer', minimum: 1, maximum: 10000, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      if (indexer.status !== 'ready') {
        return reply.code(503).send({ error: 'Index not ready' });
      }

      const { withdrawal_address, limit = 100, offset = 0 } = request.body;
      const records = indexer.query(withdrawal_address, limit, offset);
      return reply.send(records);
    },
  );
}
