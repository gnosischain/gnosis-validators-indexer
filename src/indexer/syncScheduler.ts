import { BeaconClient } from './BeaconClient';
import { IndexerManager } from './IndexerManager';
import { runFullSync } from './fullSync';
import { runQueueSync } from './queueSync';
import { SpecProvider } from './spec';
import {
  FULL_SYNC_EVERY_N_EPOCHS,
  QUEUE_SYNC_EVERY_EPOCHS,
  CHAIN_CONFIG,
} from '../config';
import { logger } from '../utils/logger';

function epochsToMs(epochs: number): number {
  return epochs * CHAIN_CONFIG.slotsPerEpoch * CHAIN_CONFIG.secondsPerSlot * 1000;
}

export function startSyncScheduler(
  client: BeaconClient,
  indexer: IndexerManager,
): void {
  const intervalMs = epochsToMs(FULL_SYNC_EVERY_N_EPOCHS);

  logger.info({ intervalMs }, 'Sync scheduler started');

  setInterval(async () => {
    try {
      await runFullSync(client, indexer);
    } catch (err) {
      logger.error({ err }, 'Scheduled sync failed — will retry next interval');
      // A re-sync failing leaves the previous index intact and still served;
      // only a service that has never built one is genuinely unready.
      if (indexer.status !== 'ready') indexer.status = 'error';
    }
  }, intervalMs);
}

export function startQueueSyncScheduler(
  client: BeaconClient,
  indexer: IndexerManager,
  specs: SpecProvider,
): void {
  const intervalMs = epochsToMs(QUEUE_SYNC_EVERY_EPOCHS);

  logger.info({ intervalMs }, 'Queue sync scheduler started');

  setInterval(async () => {
    try {
      // Inside the try: the spec may still be unfetched if the beacon node was
      // unreachable at boot, and that is a retry, not a fatal condition.
      await runQueueSync(client, indexer, await specs.get());
    } catch (err) {
      logger.error({ err }, 'Scheduled queue sync failed — will retry next interval');
    }
  }, intervalMs);
}
