import { BeaconClient } from './BeaconClient';
import { missingSpecKeys } from './queueSync';
import { logger } from '../utils/logger';

/** A spec that can never work, however many times it is re-fetched. */
export class UnusableSpecError extends Error {
  constructor(readonly missing: string[]) {
    super(`Chain spec is missing constants the queue sync needs: ${missing.join(', ')}`);
    this.name = 'UnusableSpecError';
  }
}

/**
 * The chain spec, fetched once and cached for the process lifetime.
 *
 * The two ways this can fail are not the same failure. An unreachable or slow
 * beacon node is transient and says nothing about the deployment, so the fetch
 * is simply retried on the next call — the service stays up and keeps serving
 * the registry, which needs no spec at all. A spec that is missing constants can
 * never work and no amount of retrying will fix it, so that is fatal — but the
 * caller decides that, not this class.
 *
 * Deciding it here would mean a `process.exit(1)` fired from the every-epoch
 * queue-sync timer: `spec` is assigned only on success, so a boot fetch that
 * failed leaves the check live for the process lifetime, and one partial answer
 * from a divergent backend would then kill a service that has been serving the
 * registry for days — severing in-flight responses on the way out. So `get()`
 * only ever throws, and `main()` decides what a given failure is worth.
 */
export class SpecProvider {
  private spec: Record<string, string> | null = null;

  constructor(private readonly client: BeaconClient) {}

  /**
   * Cached spec, fetching it first if needed.
   *
   * Throws if the fetch fails, and `UnusableSpecError` if the fetch succeeds
   * but the spec is unusable — fatal at boot, a logged retry after that.
   */
  async get(): Promise<Record<string, string>> {
    if (this.spec) return this.spec;

    const spec = await this.client.fetchSpec();

    const missing = missingSpecKeys(spec);
    if (missing.length > 0) throw new UnusableSpecError(missing);

    logger.info('Chain spec loaded');
    this.spec = spec;
    return spec;
  }
}
