import { CHAIN_CONFIG, PORT } from './config';
import { BeaconClient } from './indexer/BeaconClient';
import { IndexerManager } from './indexer/IndexerManager';
import { runFullSync } from './indexer/fullSync';
import { missingSpecKeys, runQueueSync } from './indexer/queueSync';
import { startQueueSyncScheduler, startSyncScheduler } from './indexer/syncScheduler';
import { buildApp } from './server/app';
import { logger } from './utils/logger';

async function main() {
  logger.info(
    { chainId: CHAIN_CONFIG.chainId, beaconUrl: CHAIN_CONFIG.beaconUrl },
    'Starting gnosis-validators-indexer',
  );

  const client = new BeaconClient(CHAIN_CONFIG.beaconUrl);
  const indexer = new IndexerManager();

  // Start HTTP server immediately so /health is available during startup
  const app = buildApp(indexer);
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT }, 'HTTP server listening');

  let spec: Record<string, string>;
  try {
    spec = await client.fetchSpec();
  } catch (err) {
    logger.fatal({ err }, 'Could not fetch chain spec — exiting');
    process.exit(1);
  }

  const missing = missingSpecKeys(spec);
  if (missing.length > 0) {
    logger.fatal({ missing }, 'Chain spec is missing constants the queue sync needs — exiting');
    process.exit(1);
  }

  try {
    await runQueueSync(client, indexer, spec);
  } catch (err) {
    logger.error({ err }, 'Initial queue sync failed — will retry on schedule');
  }

  try {
    await runFullSync(client, indexer);
  } catch (err) {
    logger.error({ err }, 'Initial full sync failed — will retry on next checkpoint');
    indexer.status = 'error';
  }

  // Schedule periodic re-syncs to catch credential changes
  startSyncScheduler(client, indexer);
  startQueueSyncScheduler(client, indexer, spec);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — shutting down');
    await app.close();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
