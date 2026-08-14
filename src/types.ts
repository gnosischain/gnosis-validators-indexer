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
  /**
   * Slot the deposit was included in */
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
   * Slot of the finalized checkpoint block */
  finalized_slot: number | null;
  /** Total CL gwei waiting in `pending_deposits`. */
  deposit_queue_gwei: string;
  deposit_queue_count: number;
  /** Earliest epoch a newly requested exit can be scheduled for. */
  exit_queue_epoch: number;
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

/** Raw inputs for a queue snapshot, before they are combined. */
export interface QueueSyncData {
  headSlot: number;
  finalizedSlot: number | null;
  deposits: PendingDepositJSON[];
  partialWithdrawals: PendingPartialWithdrawalJSON[];
  /** Highest scheduled validator exit epoch, or null when nothing is exiting. */
  exitQueueEpoch: number | null;
}
