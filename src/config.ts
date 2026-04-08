import 'dotenv/config';
import { ChainConfig } from './types';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const SLOTS_PER_EPOCH: Record<number, number> = {
  100: 16,
  10200: 16,
};

const SECONDS_PER_SLOT: Record<number, number> = {
  100: 5,
  10200: 5,
};

export const PORT = parseInt(process.env.PORT ?? '3001', 10);
export const API_KEY = requireEnv('API_KEY');
export const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
export const FULL_SYNC_EVERY_N_EPOCHS = parseInt(process.env.FULL_SYNC_EVERY_N_EPOCHS ?? '4');

const chainId = parseInt(requireEnv('CHAIN_ID'));
const beaconUrl = requireEnv(`BEACON_URL_${chainId}`);

if (!SLOTS_PER_EPOCH[chainId]) {
  throw new Error(`Unsupported CHAIN_ID: ${chainId}`);
}

export const CHAIN_CONFIG: ChainConfig = {
  chainId,
  beaconUrl: beaconUrl.replace(/\/$/, ''), // strip trailing slash
  slotsPerEpoch: SLOTS_PER_EPOCH[chainId],
  secondsPerSlot: SECONDS_PER_SLOT[chainId],
};
