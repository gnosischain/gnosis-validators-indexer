import { CHAIN_CONFIG, PORT } from './config';
import { BeaconClient } from './indexer/BeaconClient';
import { IndexerManager } from './indexer/IndexerManager';
import { runFullSync } from './indexer/fullSync';
import { startSyncScheduler } from './indexer/syncScheduler';
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

  try {
    await runFullSync(client, indexer);
  } catch (err) {
    logger.error({ err }, 'Initial full sync failed — will retry on next checkpoint');
    indexer.status = 'error';
  }

  // Schedule periodic re-syncs to catch credential changes
  startSyncScheduler(client, indexer);

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
