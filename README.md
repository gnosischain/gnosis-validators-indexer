# gnosis-validators-indexer

A lightweight service that indexes all beacon chain validators in memory, keyed by withdrawal address, for fast lookups.

## How it works

On startup the service fetches all validators from a beacon node and builds an in-memory index. It then periodically re-syncs to catch any withdrawal credential changes.

It also indexes the Electra **deposit queue**. Since Electra a validator waits in
`pending_deposits` *before* it is registered, so it has no validator index yet
and appears in no validator query — a deposit can sit there for days while being
invisible to anything that reads only the registry. Queued deposits are indexed
by withdrawal address alongside the registry, and the chain-wide queue state is
exposed for callers that want to estimate waiting times.

The queue is refreshed on its own, faster schedule — every epoch, because that
is how often it moves, while the validator registry only changes when
credentials do. Its payload is tens of KB against the registry's tens of MB, so
the two never block each other.

## API

All endpoints except `/health` and `/ready` require an `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Always 200, returns indexer status |
| `GET` | `/ready` | 200 only when index is fully loaded (use for readiness probes) |
| `POST` | `/` | Query validators by withdrawal address |
| `GET` | `/queue` | Chain-wide deposit/exit queue state |

**POST `/`** — request body:

```json
{
  "withdrawal_address": "0xabc...def",
  "limit": 100,
  "offset": 0
}
```

The response holds the validators already registered for that address plus the
deposits still waiting in the queue:

```json
{
  "validators": [
    { "validator_index": 356054, "pubkey": "0xac55...", "withdrawal_address": "0x2cd4..." }
  ],
  "queued_deposits": [
    {
      "pubkey": "0xa89d...",
      "withdrawal_address": "0x2cd4...",
      "withdrawal_credentials": "0x0200...2cd4...",
      "amount_gwei": "1600000000000",
      "gwei_ahead": "0",
      "count_ahead": 0
    }
  ]
}
```

`gwei_ahead` and `count_ahead` are how much is queued in front of that deposit —
divide `gwei_ahead` by `churn_per_epoch_gwei` from `/queue` for the epochs it
waits. `queued_deposits` includes top-ups to validators that already exist, so
drop any pubkey that also appears in `validators`.

**GET `/queue`** — chain-wide queue state, served from memory. Returns 503 until
the first queue sync lands. Amounts are raw consensus-layer gwei (mGNO gwei on
Gnosis):

```json
{
  "chain_id": 100,
  "current_epoch": 1835913,
  "seconds_per_epoch": 80,
  "churn_per_epoch_gwei": "64000000000",
  "max_pending_deposits_per_epoch": 16,
  "withdrawability_delay_epochs": 256,
  "max_seed_lookahead": 4,
  "finalized_epoch": 1835911,
  "deposit_queue_gwei": "129547768351648",
  "deposit_queue_count": 130,
  "exit_queue_epoch": 1835976,
  "exit_queue_known": true,
  "fetched_at": 1785866402588
}
```

`exit_queue_epoch` is the earliest epoch a newly requested exit could be
scheduled for. `exit_queue_known` is `false` before the first validator sync
completes, when it falls back to the earliest epoch the spec allows — treat any
estimate derived from it as a lower bound.

## Deploy with Docker

**1. Create a `.env` file:**

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
API_KEY=your-secret-key
```

The default beacon URLs in `.env.example` point to public endpoints and work out of the box. Set `BEACON_URL_100` or `BEACON_URL_10200` to use your own node.

**2. Start the services:**

```bash
docker compose up -d
```

This starts two containers:
- `validators-indexer-gnosis` on port `3001` (Gnosis mainnet, chain 100)
- `validators-indexer-chiado` on port `3002` (Chiado testnet, chain 10200)

**3. Wait for the index to load:**

```bash
# Watch until status transitions to "ready" (can take several minutes)
watch curl -s http://localhost:3001/health
```

**4. Query the service:**

```bash
curl -s -X POST http://localhost:3001/ \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"withdrawal_address": "0xYOUR_ADDRESS"}'
```

### Run a single chain

```bash
docker compose up -d validators-indexer-gnosis
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | — | Required. Key for `X-API-Key` header |
| `CHAIN_ID` | `100` | Chain to index (`100` Gnosis, `10200` Chiado) |
| `PORT` | `3001` | HTTP port |
| `BEACON_URL_<CHAIN_ID>` | public endpoint | Beacon node URL for the configured chain |
| `LOG_LEVEL` | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`) |
| `FULL_SYNC_EVERY_N_EPOCHS` | `4` | How often to re-fetch all validators |

The deposit/exit queue is re-read every epoch and is not configurable — that is
the rate the data changes at, and the payload is small enough that syncing less
often would only serve staler answers.
