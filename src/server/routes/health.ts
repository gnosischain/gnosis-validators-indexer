import { FastifyInstance } from 'fastify';
import { IndexerManager } from '../../indexer/IndexerManager';
import { CHAIN_CONFIG } from '../../config';

export function registerHealthRoutes(
  app: FastifyInstance,
  indexer: IndexerManager,
): void {
  // Always 200 — process is alive
  app.get('/health', async (_request, reply) => {
    const snapshot = indexer.healthSnapshot();
    return reply.send({
      chainId: CHAIN_CONFIG.chainId,
      status: snapshot.status,
      lastUpdatedAt: snapshot.lastUpdatedAt,
      validatorCount: snapshot.validatorCount,
      // The queue syncs on its own schedule, so a stalled queue is invisible in
      // `status` and `lastUpdatedAt`, both of which track the full sync only.
      queueReady: snapshot.queueReady,
      queueUpdatedAt: snapshot.queueUpdatedAt,
      depositQueueCount: snapshot.depositQueueCount,
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
