# Suwappu Perps Risk Monitor

A standalone, read-only perpetual-futures risk monitor for builders using [Suwappu](https://suwappu.bot).

This repository keeps the historical `suwappu-perps-trader` name, but version 2 deliberately does **not** trade. It turns Suwappu's Hyperliquid market, quote, and position reads into a durable liquidation-distance alert primitive that can sit behind a paid monitoring product.

> Perpetual futures involve leverage, funding, and liquidation risk. A quote, derived buffer, or alert is monitoring data—not financial advice, a liquidation guarantee, or an executed trade.

## The product primitive

| Command | Purpose | Authority | Persists state |
|---|---|---|---|
| `markets` | live supported market context | public read | No |
| `quote` | indicative margin/liquidation/fee estimate | authenticated read/quote | No |
| `positions` | open positions for one address | authenticated read | No |
| `risk` | derived notional, P&L-on-margin, liquidation distance, leverage utilization | authenticated read | No |
| `watch` | transition-only liquidation-distance decisions with hysteresis | authenticated read | Yes |

`watch` is the standalone product boundary. Run it from cron, a queue worker, or a scheduler; deliver only rows where `shouldNotify` is `true` to your webhook/email/pager layer.

The repository contains **no signing key, open-position, close-position, or order-placement path**.

## Quick start

Requirements: Bun 1.3.14+ and a Suwappu agent key for authenticated commands.

```bash
bun install --frozen-lockfile

export SUWAPPU_API_KEY=suwappu_sk_...
export HL_ADDRESS=0x1111111111111111111111111111111111111111

bun src/cli.ts markets --top 5
bun src/cli.ts positions --json
bun src/cli.ts risk --warn-within 10 --json
bun src/cli.ts watch --warn-within 10 --hysteresis 2 --json
```

The first `watch` run records state. A position at or below the configured warning boundary emits a `warning` transition once. It remains active through the hysteresis band and emits `recovered` only after reaching the recovery boundary.

The default example is:

- warn at a reported liquidation distance `<= 10%`;
- recover at `>= 12%` (`10 + 2` percentage points of hysteresis).

Those values illustrate the state machine; they are not Suwappu risk recommendations.

## What `watch` guarantees

The local state machine is intentionally conservative:

- rule identity is SHA-256 over wallet, market, side, and thresholds—not the upstream position index;
- an unavailable liquidation price returns `insufficient_data` and preserves the prior alert state;
- a previously alerted position disappearing from a successful positions response returns `not_returned`, **not** `recovered`;
- the first disappearance of an active alert can be delivered once for reconciliation; repeated absence is deduplicated;
- state writes use a private directory, unique temporary file, file `fsync`, atomic rename, and best-effort directory `fsync`;
- one owner-token lock prevents concurrent local processes from emitting duplicate transitions;
- corrupt state fails closed instead of being silently reset;
- no stale-lock auto-deletion guesses whether another process is dead.

Default local state is `.suwappu-perps/watch-state.json`. Containers use `/data/state` through `SUWAPPU_PERPS_STATE_DIR`.

This is a **single-node** durability contract. A multi-replica service should graduate to transactional shared state and a delivery outbox rather than mounting the JSON file on multiple workers.

## Risk snapshot semantics

For each returned position, `risk` derives:

```text
notionalUsd = abs(size) × markPrice
pnlOnMarginPct = unrealizedPnl / margin × 100       (when margin > 0)
long liquidation distance = (mark - liquidation) / mark × 100
short liquidation distance = (liquidation - mark) / mark × 100
leverage utilization = leverage / returned maxLeverage × 100
```

`liquidationPrice: 0` means unavailable on the current Suwappu position path, so the derived distance becomes `null`. A non-positive directional distance is surfaced as a warning rather than normalized away.

`fundingRate` is the current raw Hyperliquid market funding context returned through Suwappu. It is **not** accrued position funding P&L and is not a forecast.

Positions and market metadata are independent upstream reads. `computedAt` is local client computation time, so the composed snapshot is not an atomic exchange observation.

## Network and failure contract

The canonical TypeScript binary calls the documented Suwappu REST contract directly. This is deliberate: the source SDK is currently `0.6.0` while the public npm package is still `0.4.0`, and the standalone monitor needs bounded networking independent of that release gap.

Defaults:

| Control | Default | Bound |
|---|---:|---:|
| `SUWAPPU_REQUEST_TIMEOUT_MS` | 20,000 ms | 250–30,000 ms |
| `SUWAPPU_READ_RETRIES` | 2 | 0–4 |
| safe GET retry statuses | transport, 408, 429, 5xx | bounded exponential backoff; `Retry-After` capped at 5s |
| quote retries | none | one attempt |

`quote` stays one-shot because Suwappu's hosted MCP contract currently marks `perps_quote` read-only but non-idempotent. A monitoring tool should not invent retry semantics the service does not promise.

Set `SUWAPPU_API_EVENTS=1` for metadata-only stderr events containing operation, outcome, attempt, duration, and HTTP status. They intentionally exclude API keys, URLs, query strings, wallet addresses, request/response bodies, and exception text. User-facing HTTP errors also omit upstream response bodies.

`SUWAPPU_API_URL` may override the API origin. It must be HTTPS, except for localhost development; credentials, query parameters, and fragments in the configured base URL are rejected. Authenticated calls refuse to send `SUWAPPU_API_KEY` to a non-Suwappu/non-local origin unless you explicitly set `SUWAPPU_ALLOW_CUSTOM_AUTH_ORIGIN=1` after verifying that endpoint. Public `markets` reads never attach the key.

## Suwappu REST, SDK, and MCP

The same product can be assembled through three interfaces:

- REST: `GET /v1/agent/perps/markets`, `POST /v1/agent/perps/quote`, `GET /v1/agent/perps/positions`;
- TypeScript/Python SDK namespaces: `client.perps.*`;
- hosted MCP at `https://api.suwappu.bot/mcp`: `perps_markets`, `perps_quote`, `perps_positions`.

The TypeScript executable uses REST for the versioned runtime guarantees above. `trader.py` remains a small source-pinned Python SDK companion so builders can see the SDK shape without pretending a PyPI release exists.

```bash
python -m pip install -r requirements.txt
export SUWAPPU_API_KEY=suwappu_sk_...
export HL_ADDRESS=0x1111111111111111111111111111111111111111

python trader.py markets --top 5
python trader.py quote --market ETH-USD --side long --size 1 --leverage 5
python trader.py risk --warn-within 10 --json
```

The Python companion is for SDK learning and snapshot parity; the durable `watch` implementation and production container are TypeScript-first.

## Quote contract

`quote` fetches current market metadata first and validates the requested market, positive base-asset size, side, and leverage. It uses the lower of the returned Suwappu quote maximum and the current 20x request ceiling.

The result is indicative. Entry uses current venue midpoint/mark context and liquidation is approximate; it does not model a guaranteed fill, full order-book depth, or execution slippage. No transaction is signed or submitted.

## Deploy

Build the standalone executable:

```bash
bun run build
./dist/suwappu-perps --help
```

Or run the non-root container with a persistent state volume:

```bash
docker build -t suwappu-perps .
docker run --rm \
  -e SUWAPPU_API_KEY \
  -e HL_ADDRESS \
  -v suwappu-perps-state:/data \
  suwappu-perps watch --warn-within 10 --hysteresis 2 --json
```

The image defaults to `--help`, so its zero-configuration startup requires no network or credentials.

See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) before running it unattended.

## Build a business, not a P&L claim

The paid value is the monitoring workflow around trustworthy reads:

1. free market/risk explorer;
2. paid transition alerts and delivery history;
3. multi-wallet workspace with teams and acknowledgement state;
4. API/webhook plan with quotas, exports, and audit history;
5. enterprise control plane with SSO/RBAC, tenant isolation, HA state, backups, SLOs, and delivery replay;
6. optional execution handoff as a **separate authority class**.

Measure developer activation as `real wallet → saved rule → evidence-bearing watch evaluation`, then product value as successful alert delivery/acknowledgement, retained monitored wallets, and contribution margin. Do not use customer trading returns as product revenue.

See [`BUILDING_A_PRODUCT.md`](BUILDING_A_PRODUCT.md) for concrete unit economics and the graduation checklist.

## Where Suwappu ends and Hyperliquid begins

Suwappu is useful here as a smaller agent-facing read/quote boundary with REST/SDK/MCP interfaces. It is not a replacement for Hyperliquid's complete venue SDK.

Use Hyperliquid directly when you need low-latency streaming, complete venue-specific metadata, or execution/signing. Hyperliquid documents [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions), [rate and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits), and an [official Python SDK](https://github.com/hyperliquid-dex/hyperliquid-python-sdk) with trading flows.

That separation is intentional: monitoring should not silently acquire execution authority just because a venue SDK can provide it.

## Develop and verify

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build

python -m py_compile trader.py risk.py
python -m unittest discover -s tests -p 'test_*.py'
```

CI additionally runs a high-severity Bun audit, builds/smoke-tests the standalone executable, imports the pinned Python SDK, builds a non-root container, verifies zero-network startup, and runs TypeScript/Python CodeQL.

## Security

Never commit `SUWAPPU_API_KEY`, webhook secrets, or venue signing keys. This product does not need a Hyperliquid private key.

Report vulnerabilities through the process in [`SECURITY.md`](SECURITY.md).

## More

- [Suwappu docs](https://docs.suwappu.bot)
- [Perps guide](https://docs.suwappu.bot/guides/perps-trading)
- [TypeScript SDK source](https://github.com/0xSoftBoi/suwappubot/tree/main/packages/sdk)
- [Python SDK source](https://github.com/0xSoftBoi/suwappubot/tree/main/packages/sdk-python)
- [`CHANGELOG.md`](CHANGELOG.md)
- [`CONTRIBUTING.md`](CONTRIBUTING.md)

## License

MIT
