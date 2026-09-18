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
credentials do. The two are separate syncs holding separate state, so a failure
in one leaves the other's last good answer in place. They are not fully
independent in cost, though: the exit-queue tip is a filtered registry read, and
`POST /` is gated on the full sync, so it returns 503 while the registry is
being re-fetched even though the queue data is already in memory.

## API

All endpoints except `/health` and `/ready` require an `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Always 200, returns indexer and queue status |
| `GET` | `/ready` | 200 only when index is fully loaded (use for readiness probes) |
| `POST` | `/` | Query validators by withdrawal address |
| `GET` | `/queue` | Chain-wide deposit/exit queue state |

**POST `/`** — request body:

```json
{
  "withdrawal_address": "0xabc...def",
  "limit": 100,
  "offset": 0,
  "deposit_limit": 100,
  "deposit_offset": 0
}
```

`limit`/`offset` page `validators`; `deposit_limit`/`deposit_offset` page
`queued_deposits`. They are separate because the two lists are unrelated in
length — an address can hold hundreds of queued deposits and no validators, or
the reverse. `deposit_limit` is optional and unset returns every queued entry
for the address.

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
      "count_ahead": 0,
      "slot": "29374608"
    }
  ],
  "queued_deposits_total": 1
}
```

`queued_deposits_total` is how many entries the address holds in total, so a
windowed read can tell that it was windowed. `queued_deposits` is `null` — not
`[]` — when no queue sync has landed yet: the queue is unknown for every address
in that state, and an empty array would claim the address has nothing queued.
Check `queueReady` on `/health` if you need to distinguish a cold start from a
stalled queue.

`gwei_ahead` and `count_ahead` are how much is queued in front of that entry, and
`slot` is where it entered the queue. Three limits apply at once and the tightest
one sets the wait, so take the largest of the three, using constants from
`/queue`:

```
epochs ≈ max(
  ceil((gwei_ahead + amount_gwei) / churn_per_epoch_gwei), // balance per epoch
  count_ahead / max_pending_deposits_per_epoch,            // entries per epoch
  ceil(slot / slots_per_epoch) - finalized_epoch           // finality frontier
)
```

The balance term counts the entry's own `amount_gwei`, not just what sits ahead
of it: consensus credits a deposit only once the epoch's churn budget covers
everything before it *plus* the deposit itself (`process_pending_deposits`
breaks on `processed_amount + amount > available_for_processing`). Leaving it
out is optimistic in the case callers hit most — a lone deposit into an empty
queue has `gwei_ahead = 0` and still waits `amount_gwei / churn_per_epoch_gwei`
epochs, which at the maximum effective balance is 32 of them.

Balance is usually the binding limit, but a run of small top-ups hits the count
limit first — 16 entries per epoch drains far slower than the churn allows.

The third term needs care. The chain processes deposits only up to the *start*
slot of the finalized epoch, and strictly, so an entry needs finality to reach
the epoch whose start slot is at or past its own — hence `ceil`, not `floor`.
**Drop the term entirely when `finalized_epoch` is `null`** and treat the result
as a lower bound; in JavaScript `x - null === x`, so leaving it in yields
something on the order of a million epochs and renders as a multi-year ETA.

Multiply by `seconds_per_epoch` for a duration.

Each record is one entry in `pending_deposits`, not one pubkey. A pubkey can hold
several entries — each with its own amount and its own position — so several
records can share a `pubkey`. Sum `amount_gwei` across the records for an
address to get its pending total, and take the largest per-entry estimate for
when the last of it is credited.

`queued_deposits` includes top-ups to validators that already exist, and no field
distinguishes a top-up from a first deposit for a new validator. A top-up's
amount is genuinely still queued and uncredited, so do not drop it — an address
with a registered validator and a queued top-up legitimately has both. Two
caveats follow from consensus ignoring a top-up's credentials once the pubkey is
registered: a queued top-up is indexed under the address in its own
`withdrawal_credentials`, which for a top-up is not necessarily the address that
will actually receive it, and a top-up submitted with BLS (`0x00`) credentials
has no address to index at all and appears only in the chain-wide
`deposit_queue_*` totals.

**GET `/queue`** — chain-wide queue state, served from memory. Returns 503 until
the first queue sync lands. Amounts are raw consensus-layer gwei (mGNO gwei on
Gnosis):

```json
{
  "chain_id": 100,
  "current_epoch": 1835913,
  "seconds_per_epoch": 80,
  "slots_per_epoch": 16,
  "churn_per_epoch_gwei": "64000000000",
  "max_pending_deposits_per_epoch": 16,
  "withdrawability_delay_epochs": 256,
  "max_seed_lookahead": 4,
  "finalized_epoch": 1835911,
  "finalized_slot": 29374576,
  "deposit_queue_gwei": "129547768351648",
  "deposit_queue_count": 130,
  "exit_queue_epoch": 1835976,
  "exit_queue_known": true,
  "pending_partial_validator_indices": [547737],
  "fetched_at": 1785866402588
}
```

`exit_queue_epoch` is the earliest epoch a newly requested exit could be
scheduled for, refreshed every epoch with the rest of the snapshot. Validators
already exiting and pending partial withdrawals draw on the same churn, so the
tip is whichever of the two reaches furthest — or the earliest epoch the spec
allows, when nothing is exiting at all. Validators that are the source of a
pending consolidation are left out: they carry an exit epoch too, but it was
scheduled through the separate consolidation churn and says nothing about the
exit queue. If `pending_consolidations` cannot be read they are counted after
all, which can only push the tip later — pessimistic, never optimistic.

It is a lower bound in every case. The churn an exit consumes depends on the
exiting validator's own balance, which is not known until the exit is requested,
so a large compounding validator lands later than this field reports.

`exit_queue_known` is `true` only when both inputs — validators already exiting
and pending partial withdrawals — were read. When it is `false` one of them
could not be read, so the tip is missing whatever that input would have
contributed: it may still be a real measurement from the other input, or it may
be the bare spec floor, and the response does not distinguish the two. Read it
as "not fully measured" rather than "fell back to the spec floor". The rest of
the snapshot is unaffected.

`pending_partial_validator_indices` lists every validator with a partial
withdrawal still waiting in the queue, sorted ascending. The consensus layer
drops a full exit request for such a validator without any error (EIP-7002:
"only exit validator if it has no pending withdrawals in the queue"), so a
caller about to submit one should check for the index here first. It is `null`
— not `[]` — when the partial withdrawals could not be read: an empty list
would claim nobody has one pending. `exit_queue_known` is `false` in the same
case.

`finalized_slot` is the slot of the finalized checkpoint block. It is a lower
bound on the frontier the chain actually processes to — a skipped block at the
epoch boundary leaves the checkpoint header a few slots short — so estimates
built on it err pessimistic, never optimistic. Both finality fields are `null`
if the checkpoint could not be read; the rest of the snapshot is still valid.

**GET `/health`** — always 200, no API key:

```json
{
  "chainId": 100,
  "status": "ready",
  "lastUpdatedAt": "2026-08-14T10:12:03.114Z",
  "validatorCount": 483012,
  "queueReady": true,
  "queueUpdatedAt": "2026-08-14T10:15:41.882Z",
  "depositQueueCount": 161
}
```

`status`, `lastUpdatedAt` and `validatorCount` describe the validator registry;
`queueReady`, `queueUpdatedAt` and `depositQueueCount` describe the queue. The
two sync separately, so watch `queueUpdatedAt` to catch a stalled queue —
`status` will happily read `ready` while the queue has not moved for hours.

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

### Beacon node requirements

The queue sync reads chain constants from `/eth/v1/config/spec` and needs an
Electra-or-later spec. The constants are fetched once and cached; if the node is
unreachable at startup the service still comes up and serves the registry, and
the fetch is retried on the next queue sync. A spec that is reachable but missing
required constants — a pre-Electra or trimmed spec — is a configuration error the
service cannot work around, and it exits with the missing keys logged.
