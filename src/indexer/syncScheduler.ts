import { BeaconClient } from './BeaconClient';
import { IndexerManager } from './IndexerManager';
import { runFullSync } from './fullSync';
import { FULL_SYNC_EVERY_N_EPOCHS, CHAIN_CONFIG } from '../config';
import { logger } from '../utils/logger';

export function startSyncScheduler(
  client: BeaconClient,
  indexer: IndexerManager,
): void {
  const intervalMs =
    FULL_SYNC_EVERY_N_EPOCHS * CHAIN_CONFIG.slotsPerEpoch * CHAIN_CONFIG.secondsPerSlot * 1000;

  logger.info({ intervalMs }, 'Sync scheduler started');

  setInterval(async () => {
    try {
      await runFullSync(client, indexer);
    } catch (err) {
      logger.error({ err }, 'Scheduled sync failed — will retry next interval');
    }
  }, intervalMs);
}
