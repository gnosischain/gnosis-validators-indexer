import { FastifyInstance } from 'fastify';
import { IndexerManager } from '../../indexer/IndexerManager';
import { apiKeyHook } from '../middleware/apiKey';

/**
 * Chain-wide activation/exit queue state.
 *
 * Address-independent, so it is a plain GET and every caller gets the same
 * answer straight from memory.
 */
export function registerQueueRoute(
  app: FastifyInstance,
  indexer: IndexerManager,
): void {
  app.get('/queue', { preHandler: apiKeyHook }, async (_request, reply) => {
    const snapshot = indexer.queueSnapshot();
    if (!snapshot) {
      return reply.code(503).send({ error: 'Queue snapshot not ready' });
    }
    return reply.send(snapshot);
  });
}
