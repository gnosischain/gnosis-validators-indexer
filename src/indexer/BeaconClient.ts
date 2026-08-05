import {
  BeaconValidatorJSON,
  FAR_FUTURE_EPOCH,
  PendingDepositJSON,
  PendingPartialWithdrawalJSON,
  QueueSyncData,
  ValidatorRecord,
} from '../types';
import { logger } from '../utils/logger';

/** Queue endpoints are small; the validator registry is not, so it gets no timeout. */
const QUEUE_TIMEOUT_MS = 20_000;

export class BeaconClient {
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string, timeoutMs = QUEUE_TIMEOUT_MS): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Beacon API error ${res.status} on ${path}: ${body}`);
    }

    const json = await res.json() as { data: T };
    return json.data;
  }

  /**
   * Fetch active and pending validators from beacon state.
   * Exited/withdrawal validators are excluded — only active and pending are indexed.
   * Validators with BLS (0x00) credentials are also excluded as they have no EVM address.
   */
  async fetchAllValidators(stateId = 'head'): Promise<ValidatorRecord[]> {
    const path = `/eth/v1/beacon/states/${stateId}/validators?status=active&status=pending`;
    logger.info({ url: `${this.baseUrl}${path}` }, 'Fetching all validators');

    // No timeout: the full registry is megabytes and can take a while.
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip' },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Beacon API error ${res.status}: ${body}`);
    }

    const json = await res.json() as { data: BeaconValidatorJSON[] };

    const records: ValidatorRecord[] = [];

    for (const v of json.data) {
      const creds = v.validator.withdrawal_credentials.toLowerCase();
      // 0x01 / 0x02 credentials: last 20 bytes are the EVM address
      if (creds.startsWith('0x01') || creds.startsWith('0x02')) {
        records.push({
          validator_index: parseInt(v.index, 10),
          pubkey: v.validator.pubkey.toLowerCase(),
          withdrawal_address: '0x' + creds.slice(-40),
        });
      }
      // 0x00 (BLS) credentials have no EVM address — skip
    }

    return records;
  }

  /**
   * Tip of the exit queue: the highest scheduled exit epoch, or null when
   * nothing is exiting. Approximates the beacon state's `earliest_exit_epoch`.
   */
  async fetchExitQueueTip(stateId = 'head'): Promise<number | null> {
    const validators = await this.get<BeaconValidatorJSON[]>(
      `/eth/v1/beacon/states/${stateId}/validators` +
        '?status=active_exiting&status=active_slashed&status=pending',
    );

    let tip: number | null = null;
    for (const v of validators) {
      // `pending` is unfiltered, so the far-future sentinel still has to be
      // skipped here — Number() would round it to a nonsense epoch.
      if (v.validator.exit_epoch === FAR_FUTURE_EPOCH) continue;
      const exitEpoch = Number(v.validator.exit_epoch);
      if (tip === null || exitEpoch > tip) tip = exitEpoch;
    }

    return tip;
  }

  /** Chain constants. Static between forks, so callers should fetch once. */
  async fetchSpec(): Promise<Record<string, string>> {
    return this.get<Record<string, string>>('/eth/v1/config/spec');
  }

  /**
   * Everything the queue snapshot needs, in one round of parallel requests.
   *
   * The finalized checkpoint is read from `headers/finalized` rather than
   * `states/head/finality_checkpoints`: on the public Gnosis endpoint the latter
   * is served by a backend whose finalized epoch runs over a thousand epochs
   * stale, while `headers/finalized` stays correct and epoch-aligned.
   */
  async fetchQueueData(stateId = 'head'): Promise<QueueSyncData> {
    const [head, finalized, deposits, partialWithdrawals, exitQueueEpoch] = await Promise.all([
      this.get<{ header: { message: { slot: string } } }>('/eth/v1/beacon/headers/head'),
      this.get<{ header: { message: { slot: string } } }>('/eth/v1/beacon/headers/finalized')
        .catch((err) => {
          logger.warn({ err }, 'Could not read finalized checkpoint');
          return null;
        }),
      this.get<PendingDepositJSON[]>(`/eth/v1/beacon/states/${stateId}/pending_deposits`),
      this.get<PendingPartialWithdrawalJSON[]>(
        `/eth/v1/beacon/states/${stateId}/pending_partial_withdrawals`,
      ).catch((err) => {
        logger.warn({ err }, 'Could not read pending partial withdrawals');
        return [] as PendingPartialWithdrawalJSON[];
      }),
      this.fetchExitQueueTip(stateId),
    ]);

    return {
      headSlot: Number(head.header.message.slot),
      finalizedSlot: finalized ? Number(finalized.header.message.slot) : null,
      deposits,
      partialWithdrawals,
      exitQueueEpoch,
    };
  }

  /** Quick liveness check against the beacon node. */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/eth/v1/beacon/headers/head`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
