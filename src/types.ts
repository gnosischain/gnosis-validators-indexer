export interface ValidatorRecord {
  validator_index: number;
  pubkey: string;            // 0x-prefixed hex
  withdrawal_address: string; // 0x-prefixed 20-byte EVM address, lowercase
}

/**
 * One entry in `pending_deposits`.
 *
 * A pubkey can hold several entries, each at its own position and each naming
 * its own credentials, so entries are never merged: one record per entry keeps
 * every position truthful, and a caller sums `amount_gwei` across the records it
 * gets back for the address total.
 */
export interface QueuedDepositRecord {
  pubkey: string;
  withdrawal_address: string;
  withdrawal_credentials: string;
  /** Amount this entry queues, in CL gwei. */
  amount_gwei: string;
  /** Gwei queued strictly ahead of this entry. */
  gwei_ahead: string;
  /** Number of queue entries strictly ahead of this entry. */
  count_ahead: number;
  /** Slot the deposit was included in. */
  slot: string;
}

export interface QueueSnapshot {
  chain_id: number;
  current_epoch: number;
  seconds_per_epoch: number;
  slots_per_epoch: number;
  /** Balance the activation/exit churn admits per epoch, in CL gwei. */
  churn_per_epoch_gwei: string;
  max_pending_deposits_per_epoch: number;
  /** Epochs between an exit taking effect and the balance being withdrawable. */
  withdrawability_delay_epochs: number;
  max_seed_lookahead: number;
  /**
   * Finalized checkpoint epoch, or null if it could not be read. Deposits are
   * only processed once their slot is finalized, so the distance from
   * `current_epoch` is what stretches a deposit's wait.
   */
  finalized_epoch: number | null;
  /**
   * Slot of the finalized checkpoint block. A lower bound on the frontier the
   * chain processes to: a skipped block at the epoch boundary leaves the
   * checkpoint header a few slots short.
   */
  finalized_slot: number | null;
  /** Total CL gwei waiting in `pending_deposits`. */
  deposit_queue_gwei: string;
  deposit_queue_count: number;
  /** Earliest epoch a newly requested exit can be scheduled for. */
  exit_queue_epoch: number;
  /**
   * False when the exit queue could not be observed and `exit_queue_epoch` fell
   * back to the earliest epoch the spec allows. The floor is a lower bound, so
   * treat the field as a floor rather than an estimate when this is false.
   */
  exit_queue_known: boolean;
  /**
   * Validators with a partial withdrawal waiting in the queue, ascending. The
   * consensus layer drops a full exit request for any of them without an error
   * (EIP-7002: a validator exits only if it has no pending withdrawals), so a
   * caller about to submit one should check for the index here first. `null`
   * when the partial withdrawals could not be read — an empty array would claim
   * nobody has one pending.
   */
  pending_partial_validator_indices: number[] | null;
  fetched_at: number;
}

export type IndexerStatus = 'booting' | 'loading' | 'ready' | 'error';

export interface ChainConfig {
  chainId: number;
  beaconUrl: string;
  slotsPerEpoch: number;
  secondsPerSlot: number;
}

/** `exit_epoch` for a validator that is not exiting. */
export const FAR_FUTURE_EPOCH = '18446744073709551615';

// Shape returned by /eth/v1/beacon/states/{id}/validators
export interface BeaconValidatorJSON {
  index: string;
  validator: {
    pubkey: string;
    withdrawal_credentials: string;
    exit_epoch: string;
  };
}

// Shape returned by /eth/v1/beacon/states/{id}/pending_deposits
export interface PendingDepositJSON {
  pubkey: string;
  withdrawal_credentials: string;
  amount: string;
  slot: string;
}

// Shape returned by /eth/v1/beacon/states/{id}/pending_partial_withdrawals
export interface PendingPartialWithdrawalJSON {
  validator_index: string;
  amount: string;
  withdrawable_epoch: string;
}

// Shape returned by /eth/v1/beacon/states/{id}/pending_consolidations
export interface PendingConsolidationJSON {
  source_index: string;
  target_index: string;
}

/** Raw inputs for a queue snapshot, before they are combined. */
export interface QueueSyncData {
  headSlot: number;
  finalizedSlot: number | null;
  deposits: PendingDepositJSON[];
  partialWithdrawals: PendingPartialWithdrawalJSON[];
  /** Highest scheduled validator exit epoch, or null when nothing is exiting. */
  exitQueueEpoch: number | null;
  /**
   * Whether the two exit-queue inputs were actually read. Both degrade to a
   * value indistinguishable from "nothing is exiting" on a fetch failure —
   * `null` and `[]` — so the distinction has to be carried separately.
   */
  exitQueueObserved: boolean;
  partialWithdrawalsObserved: boolean;
}
