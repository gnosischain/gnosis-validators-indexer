import { ValidatorRecord, IndexerStatus } from '../types';
import { logger } from '../utils/logger';

export class IndexerManager {
  // Primary lookup: validator_index → full record
  private byIndex = new Map<number, ValidatorRecord>();
  // Secondary lookup: lowercase withdrawal_address → Set of validator indices
  private byAddress = new Map<string, Set<number>>();

  // Pending maps built during a full sync — swapped in atomically
  private pendingByIndex: Map<number, ValidatorRecord> | null = null;
  private pendingByAddress: Map<string, Set<number>> | null = null;

  public status: IndexerStatus = 'booting';
  public lastUpdatedAt: Date | null = null;
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  healthSnapshot() {
    return {
      status: this.status,
      lastUpdatedAt: this.lastUpdatedAt,
      validatorCount: this.validatorCount,
    };
  }
}
