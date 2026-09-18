import { BeaconClient } from './BeaconClient';
import { IndexerManager } from './IndexerManager';
import { CHAIN_CONFIG } from '../config';
import { QueueSnapshot, QueuedDepositRecord } from '../types';
import { logger } from '../utils/logger';

/** Chain constants every queue snapshot is derived from. */
const REQUIRED_SPEC_KEYS = [
  'MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT',
  'MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA',
  'MAX_PENDING_DEPOSITS_PER_EPOCH',
  'MAX_SEED_LOOKAHEAD',
  'MIN_VALIDATOR_WITHDRAWABILITY_DELAY',
];

/**
 * Required constants this spec does not carry.
 *
 * Checked at startup rather than per sync: a pre-Electra or trimmed spec makes
 * every future sync fail the same way, so it is a boot failure, not a retry.
 */
export function missingSpecKeys(spec: Record<string, string>): string[] {
  return REQUIRED_SPEC_KEYS.filter((key) => spec[key] === undefined);
}

/**
 * Balance the activation/exit churn admits per epoch.
 *
 * The spec computes `min(MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT,
 * max(MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA, total_active_balance /
 * CHURN_LIMIT_QUOTIENT))`. On Gnosis and Chiado
 */
function churnPerEpochGwei(spec: Record<string, string>): bigint {
  const cap = BigInt(spec.MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT);
  const floor = BigInt(spec.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA);
  if (floor >= cap) return cap;

  logger.warn(
    { cap: cap.toString(), floor: floor.toString() },
    'MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA is below the activation/exit cap — churn is an upper bound',
  );
  return cap;
}

export async function runQueueSync(
  client: BeaconClient,
  indexer: IndexerManager,
  spec: Record<string, string>,
): Promise<void> {
  const start = Date.now();

  const {
    headSlot,
    finalizedSlot,
    deposits,
    partialWithdrawals,
    exitQueueEpoch: validatorExitEpoch,
    exitQueueObserved,
    partialWithdrawalsObserved,
  } = await client.fetchQueueData('head');

  const slotsPerEpoch = CHAIN_CONFIG.slotsPerEpoch;
  const currentEpoch = Math.floor(headSlot / slotsPerEpoch);
  const maxSeedLookahead = Number(spec.MAX_SEED_LOOKAHEAD);
  const withdrawabilityDelay = Number(spec.MIN_VALIDATOR_WITHDRAWABILITY_DELAY);

  // ─── Deposit queue ──────────────────────────────────────────────────────────
  // One pass in queue order: the running total is what a deposit waits behind.
  //
  // Entries are emitted one-for-one rather than merged per pubkey. Merging lost
  // data in both directions: a pubkey's entries can name different withdrawal
  // addresses (consensus ignores the credentials of a top-up to a registered
  // pubkey, so they are not even constrained to agree), and a running total
  // taken at the last entry already counts that pubkey's own earlier entries.
  const queuedByAddress = new Map<string, QueuedDepositRecord[]>();

  let gweiAhead = 0n;
  let skippedBlsEntries = 0;

  for (const [index, deposit] of deposits.entries()) {
    const creds = deposit.withdrawal_credentials.toLowerCase();

    if (creds.startsWith('0x01') || creds.startsWith('0x02')) {
      const address = '0x' + creds.slice(-40);

      const record: QueuedDepositRecord = {
        pubkey: deposit.pubkey.toLowerCase(),
        withdrawal_address: address,
        withdrawal_credentials: creds,
        amount_gwei: deposit.amount,
        gwei_ahead: gweiAhead.toString(),
        count_ahead: index,
        slot: deposit.slot,
      };

      let list = queuedByAddress.get(address);
      if (!list) {
        list = [];
        queuedByAddress.set(address, list);
      }
      list.push(record);
    } else {
      // 0x00 (BLS) credentials carry no EVM address to key on, so the entry can
      // only be counted chain-wide. Surfaced below so it is not silent.
      skippedBlsEntries++;
    }

    gweiAhead += BigInt(deposit.amount);
  }

  // ─── Exit queue ─────────────────────────────────────────────────────────────
  // Two things push the tip past the earliest epoch the spec allows, and the
  // later of them wins: validators with an exit already scheduled, and pending
  // partial withdrawals — which consume exit churn without setting a validator
  // exit epoch, so their withdrawable epoch is walked back by the fixed delay to
  // recover the epoch they were scheduled for.
  let exitQueueEpoch = currentEpoch + 1 + maxSeedLookahead;

  if (validatorExitEpoch !== null && validatorExitEpoch > exitQueueEpoch) {
    exitQueueEpoch = validatorExitEpoch;
  }

  const pendingPartialIndices = new Set<number>();
  for (const w of partialWithdrawals) {
    const scheduled = Number(w.withdrawable_epoch) - withdrawabilityDelay;
    if (scheduled > exitQueueEpoch) exitQueueEpoch = scheduled;
    pendingPartialIndices.add(Number(w.validator_index));
  }

  // Conservative: true only when both inputs were read. They are applied
  // independently above, so one of them failing can still leave a real
  // measurement here — this reports "not fully measured", which is weaker than
  // the estimate the field otherwise carries, not "fell back to the spec floor".
  const exitQueueKnown = exitQueueObserved && partialWithdrawalsObserved;

  const snapshot: QueueSnapshot = {
    chain_id: CHAIN_CONFIG.chainId,
    current_epoch: currentEpoch,
    seconds_per_epoch: CHAIN_CONFIG.secondsPerSlot * slotsPerEpoch,
    slots_per_epoch: slotsPerEpoch,
    churn_per_epoch_gwei: churnPerEpochGwei(spec).toString(),
    max_pending_deposits_per_epoch: Number(spec.MAX_PENDING_DEPOSITS_PER_EPOCH),
    withdrawability_delay_epochs: withdrawabilityDelay,
    max_seed_lookahead: maxSeedLookahead,
    finalized_epoch: finalizedSlot === null ? null : Math.floor(finalizedSlot / slotsPerEpoch),
    finalized_slot: finalizedSlot,
    // Every entry was added to the running total, so it ends at the queue total.
    deposit_queue_gwei: gweiAhead.toString(),
    deposit_queue_count: deposits.length,
    exit_queue_epoch: exitQueueEpoch,
    exit_queue_known: exitQueueKnown,
    // null, not []: unread partials must not read as "nobody has one pending".
    pending_partial_validator_indices: partialWithdrawalsObserved
      ? [...pendingPartialIndices].sort((a, b) => a - b)
      : null,
    fetched_at: Date.now(),
  };

  indexer.commitQueue(snapshot, queuedByAddress);

  logger.debug(
    {
      depositQueueCount: snapshot.deposit_queue_count,
      exitQueueEpoch: snapshot.exit_queue_epoch,
      exitQueueKnown: snapshot.exit_queue_known,
      pendingPartialCount: pendingPartialIndices.size,
      skippedBlsEntries,
      durationMs: Date.now() - start,
    },
    'Queue sync complete',
  );

  if (skippedBlsEntries > 0) {
    logger.info(
      { skippedBlsEntries },
      'Queue entries with BLS credentials are absent from the address index',
    );
  }
}
