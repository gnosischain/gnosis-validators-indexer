import { FastifyInstance } from 'fastify';
import { IndexerManager } from '../../indexer/IndexerManager';
import { CHAIN_CONFIG } from '../../config';

export function registerHealthRoutes(
  app: FastifyInstance,
  indexer: IndexerManager,
): void {
  // Always 200 — process is alive
  app.get('/health', async (_request, reply) => {
    return reply.send({
      chainId: CHAIN_CONFIG.chainId,
      ...indexer.healthSnapshot(),
    });
  });

  // 200 when ready, 503 during startup — used by Docker/k8s readiness probes
  app.get('/ready', async (_request, reply) => {
    if (indexer.status !== 'ready') {
      return reply.code(503).send({ error: 'Not ready', indexerStatus: indexer.status });
    }
    return reply.send({ status: 'ready' });
  });
}
