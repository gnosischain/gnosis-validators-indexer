import { BeaconValidatorJSON, ValidatorRecord } from '../types';
import { logger } from '../utils/logger';

export class BeaconClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * Fetch all validators from beacon state.
   * Only extracts validator_index, pubkey, and withdrawal_address —
   * Validators with BLS (0x00) credentials are excluded as they have no EVM address.
   */
  async fetchAllValidators(stateId = 'head'): Promise<ValidatorRecord[]> {
    const url = `${this.baseUrl}/eth/v1/beacon/states/${stateId}/validators`;
    logger.info({ url }, 'Fetching all validators');

    const res = await fetch(url, { headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip' } });

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
