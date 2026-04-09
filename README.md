# gnosis-validators-indexer

A lightweight service that indexes all beacon chain validators in memory, keyed by withdrawal address, for fast lookups. Built for use with [consolidate-ui](https://github.com/gnosischain/consolidate-ui).

## How it works

On startup the service fetches all validators from a beacon node and builds an in-memory index. It then periodically re-syncs to catch any withdrawal credential changes.

## API

All endpoints except `/health` and `/ready` require an `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Always 200, returns indexer status |
| `GET` | `/ready` | 200 only when index is fully loaded (use for readiness probes) |
| `POST` | `/` | Query validators by withdrawal address |

**POST `/`** — request body:

```json
{
  "withdrawal_address": "0xabc...def",
  "limit": 100,
  "offset": 0
}
```

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
