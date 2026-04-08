export interface ValidatorRecord {
  validator_index: number;
  pubkey: string;            // 0x-prefixed hex
  withdrawal_address: string; // 0x-prefixed 20-byte EVM address, lowercase
}

export type IndexerStatus = 'booting' | 'loading' | 'ready' | 'error';

export interface ChainConfig {
  chainId: number;
  beaconUrl: string;
  slotsPerEpoch: number;
  secondsPerSlot: number;
}

// Shape returned by /eth/v1/beacon/states/{id}/validators
export interface BeaconValidatorJSON {
  index: string;
  validator: {
    pubkey: string;
    withdrawal_credentials: string;
  };
}
