import { FastifyInstance } from 'fastify';
import { IndexerManager } from '../../indexer/IndexerManager';
import { apiKeyHook } from '../middleware/apiKey';

interface QueryBody {
  withdrawal_address: string;
  limit?: number;
  offset?: number;
  deposit_limit?: number;
  deposit_offset?: number;
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
            // Queued deposits page separately from validators — the two lists
            // are unrelated in length. Unset returns every queued entry.
            deposit_limit: { type: 'integer', minimum: 1, maximum: 10000 },
            deposit_offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      if (indexer.status !== 'ready') {
        return reply.code(503).send({ error: 'Index not ready' });
      }

      const {
        withdrawal_address,
        limit = 100,
        offset = 0,
        deposit_limit,
        deposit_offset = 0,
      } = request.body;

      const queued = indexer.queryQueuedDeposits(
        withdrawal_address,
        deposit_limit,
        deposit_offset,
      );

      return reply.send({
        validators: indexer.query(withdrawal_address, limit, offset),
        // null, not [], when no queue sync has landed: the queue is unknown
        // rather than known to be empty for this address.
        queued_deposits: queued === null ? null : queued.deposits,
        queued_deposits_total: queued === null ? null : queued.total,
      });
    },
  );
}
