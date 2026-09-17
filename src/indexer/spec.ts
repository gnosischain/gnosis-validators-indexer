import { BeaconClient } from './BeaconClient';
import { missingSpecKeys } from './queueSync';
import { logger } from '../utils/logger';

/**
 * The chain spec, fetched once and cached for the process lifetime.
 *
 * The two ways this can fail are not the same failure. An unreachable or slow
 * beacon node is transient and says nothing about the deployment, so the fetch
 * is simply retried on the next call — the service stays up and keeps serving
 * the registry, which needs no spec at all. A spec that is missing constants can
 * never work and no amount of retrying will fix it, so that stays fatal.
 */
export class SpecProvider {
  private spec: Record<string, string> | null = null;

  constructor(private readonly client: BeaconClient) {}

  /** Cached spec, fetching it first if needed. Throws if the fetch fails. */
  async get(): Promise<Record<string, string>> {
    if (this.spec) return this.spec;

    const spec = await this.client.fetchSpec();

    const missing = missingSpecKeys(spec);
    if (missing.length > 0) {
      logger.fatal({ missing }, 'Chain spec is missing constants the queue sync needs — exiting');
      process.exit(1);
    }

    logger.info('Chain spec loaded');
    this.spec = spec;
    return spec;
  }
}
