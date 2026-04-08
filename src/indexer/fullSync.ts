import { BeaconClient } from './BeaconClient';
import { IndexerManager } from './IndexerManager';
import { logger } from '../utils/logger';

export async function runFullSync(
  client: BeaconClient,
  indexer: IndexerManager,
): Promise<void> {
  const start = Date.now();
  logger.info('Starting full validator sync');

  indexer.status = 'loading';

  const validators = await client.fetchAllValidators('head');

  indexer.beginPending();
  for (const record of validators) {
    indexer.addPending(record);
  }
  indexer.commitPending();

  logger.info(
    { validatorCount: validators.length, durationMs: Date.now() - start },
    'Full validator sync complete',
  );
}
