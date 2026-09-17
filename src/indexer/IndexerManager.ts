import { IndexerStatus, QueueSnapshot, QueuedDepositRecord, ValidatorRecord } from '../types';
import { logger } from '../utils/logger';

export class IndexerManager {
  // Primary lookup: validator_index → full record
  private byIndex = new Map<number, ValidatorRecord>();
  // Secondary lookup: lowercase withdrawal_address → Set of validator indices
  private byAddress = new Map<string, Set<number>>();

  // Pending maps built during a full sync — swapped in atomically
  private pendingByIndex: Map<number, ValidatorRecord> | null = null;
  private pendingByAddress: Map<string, Set<number>> | null = null;

  // Queued deposits: lowercase withdrawal_address → deposits awaiting processing.
  // Refreshed by the queue sync, which runs far more often than the full sync.
  //
  // null until the first queue sync lands: an empty Map here would answer "this
  // address has nothing queued" for every address while the queue is unknown,
  // which is a wrong answer rather than a missing one.
  private queuedByAddress: Map<string, QueuedDepositRecord[]> | null = null;
  private snapshot: QueueSnapshot | null = null;

  public status: IndexerStatus = 'booting';
  public lastUpdatedAt: Date | null = null;
  public queueUpdatedAt: Date | null = null;
  public validatorCount = 0;

  // ─── Query ────────────────────────────────────────────────────────────────

  query(
    withdrawal_address: string,
    limit: number,
    offset: number,
  ): ValidatorRecord[] {
    const addr = withdrawal_address.toLowerCase();
    const indices = this.byAddress.get(addr);
    if (!indices || indices.size === 0) return [];

    const result: ValidatorRecord[] = [];
    let skipped = 0;

    for (const idx of indices) {
      if (skipped < offset) { skipped++; continue; }
      if (result.length >= limit) break;
      const rec = this.byIndex.get(idx);
      if (rec) result.push(rec);
    }

    return result;
  }

  /**
   * Deposits queued for an address that have not been processed yet, with the
   * total held for that address so a windowed read can tell it was windowed.
   *
   * Paginated independently of the validator query: the two lists have unrelated
   * lengths, so one shared window silently truncated one of them. `limit`
   * omitted returns every entry for the address.
   *
   * Returns null when no queue sync has landed yet — distinct from an empty
   * array, which asserts the address genuinely has nothing queued.
   */
  queryQueuedDeposits(
    withdrawal_address: string,
    limit?: number,
    offset = 0,
  ): { deposits: QueuedDepositRecord[]; total: number } | null {
    if (!this.queuedByAddress) return null;

    const all = this.queuedByAddress.get(withdrawal_address.toLowerCase()) ?? [];
    return {
      deposits: limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit),
      total: all.length,
    };
  }

  /** The last committed queue snapshot, or null before the first sync lands. */
  queueSnapshot(): QueueSnapshot | null {
    return this.snapshot;
  }

  // ─── Full sync (atomic swap) ───────────────────────────────────────────────

  /** Start building a new pending index. Call before processing a full sync batch. */
  beginPending(): void {
    this.pendingByIndex = new Map();
    this.pendingByAddress = new Map();
  }

  /** Add a record to the pending index. Must call beginPending() first. */
  addPending(record: ValidatorRecord): void {
    if (!this.pendingByIndex || !this.pendingByAddress) {
      throw new Error('beginPending() must be called before addPending()');
    }

    this.pendingByIndex.set(record.validator_index, record);

    let set = this.pendingByAddress.get(record.withdrawal_address);
    if (!set) {
      set = new Set();
      this.pendingByAddress.set(record.withdrawal_address, set);
    }
    set.add(record.validator_index);
  }

  /**
   * Atomically swap the live Maps with the pending Maps.
   * Node.js is single-threaded — two assignments in the same tick
   * are always seen together by any concurrent reads.
   */
  commitPending(): void {
    if (!this.pendingByIndex || !this.pendingByAddress) {
      throw new Error('beginPending() must be called before commitPending()');
    }

    this.byIndex = this.pendingByIndex;
    this.byAddress = this.pendingByAddress;
    this.pendingByIndex = null;
    this.pendingByAddress = null;

    this.validatorCount = this.byIndex.size;
    this.lastUpdatedAt = new Date();
    this.status = 'ready';

    logger.info({ validatorCount: this.validatorCount }, 'Full sync committed');
  }

  // ─── Queue sync (atomic swap) ──────────────────────────────────────────────

  /** Replace the queue index and snapshot in one tick. */
  commitQueue(
    snapshot: QueueSnapshot,
    queuedByAddress: Map<string, QueuedDepositRecord[]>,
  ): void {
    this.snapshot = snapshot;
    this.queuedByAddress = queuedByAddress;
    this.queueUpdatedAt = new Date();

    logger.debug(
      {
        depositQueueCount: snapshot.deposit_queue_count,
        addressesWithQueuedDeposits: queuedByAddress.size,
      },
      'Queue sync committed',
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  healthSnapshot() {
    return {
      status: this.status,
      lastUpdatedAt: this.lastUpdatedAt,
      validatorCount: this.validatorCount,
      queueUpdatedAt: this.queueUpdatedAt,
      queueReady: this.queuedByAddress !== null,
      depositQueueCount: this.snapshot?.deposit_queue_count ?? null,
    };
  }
}
