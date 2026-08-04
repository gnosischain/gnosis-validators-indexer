export interface ValidatorRecord {
  validator_index: number;
  pubkey: string;            // 0x-prefixed hex
  withdrawal_address: string; // 0x-prefixed 20-byte EVM address, lowercase
}

export interface QueuedDepositRecord {
  pubkey: string;
  withdrawal_address: string;
  withdrawal_credentials: string;
  /** Total queued for this pubkey, summed over its entries in the queue. */
  amount_gwei: string;
  /** Gwei queued strictly ahead of this deposit's last entry. */
  gwei_ahead: string;
  /** Number of queue entries strictly ahead of this deposit's last entry. */
  count_ahead: number;
}

export interface QueueSnapshot {
  chain_id: number;
  current_epoch: number;
  seconds_per_epoch: number;
  /** Balance the activation/exit churn admits per epoch, in CL gwei. */
  churn_per_epoch_gwei: string;
  max_pending_deposits_per_epoch: number;
  /** Epochs between an exit taking effect and the balance being withdrawable. */
  withdrawability_delay_epochs: number;
  max_seed_lookahead: number;
  /** Observed distance from head to the finalized checkpoint. 2 on a healthy chain. */
  finality_lag_epochs: number;
  /** Total CL gwei waiting in `pending_deposits`. */
  deposit_queue_gwei: string;
  deposit_queue_count: number;
  /** Earliest epoch a newly requested exit can be scheduled for. */
  exit_queue_epoch: number;
  /** False when the exit queue was not observed and the floor was used instead. */
  exit_queue_known: boolean;
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

/** Result of a full validator sync. */
export interface ValidatorSyncResult {
  records: ValidatorRecord[];
  /**
   * Highest scheduled exit epoch seen across the registry, or null when nothing
   * is exiting. Approximates the beacon state's `earliest_exit_epoch`.
   */
  exitQueueEpoch: number | null;
}

/** Raw inputs for a queue snapshot, before they are combined. */
export interface QueueSyncData {
  headSlot: number;
  finalizedSlot: number | null;
  deposits: PendingDepositJSON[];
  partialWithdrawals: PendingPartialWithdrawalJSON[];
}
