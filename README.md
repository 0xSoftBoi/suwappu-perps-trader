# Suwappu Perps Explorer

A read-only perpetual-futures example for builders using [Suwappu](https://suwappu.bot).

The repository is named `suwappu-perps-trader` for compatibility, but its code deliberately exposes only market discovery, hypothetical quotes, position reads, and derived risk snapshots. It has no order-placement command and cannot open or close a leveraged position.

> Perpetual futures involve leverage, funding, and liquidation risk. A quote or risk flag is analysis, not a recommendation or an executed trade.

## Why this example is useful

The first three commands are intentionally thin SDK examples. `risk` is the product primitive: it combines positions plus market metadata into a stable snapshot that an alerting service, dashboard, research API, or agent can consume.

| CLI command | Suwappu surface | What it adds | Side effect |
|---|---|---|---|
| `markets` | `client.perps.markets()` / `perps_markets` | discover supported markets | read-only |
| `quote` | `client.perps.quote(...)` / `perps_quote` | hypothetical margin/liquidation/fee estimate | read-only |
| `positions` | `client.perps.positions(address)` / `perps_positions` | inspect one address | read-only |
| `risk` | positions + markets | liquidation buffer, notional, P&L-on-margin, warnings | read-only |

Hosted MCP endpoint: `https://api.suwappu.bot/mcp`.

## TypeScript quick start

```bash
git clone https://github.com/0xSoftBoi/suwappu-perps-trader.git
cd suwappu-perps-trader
bun install

export SUWAPPU_API_KEY=suwappu_sk_...
export HL_ADDRESS=0x1111111111111111111111111111111111111111

bun src/cli.ts markets --top 5
bun src/cli.ts quote --market ETH-USD --side long --size 1 --leverage 5
bun src/cli.ts positions
bun src/cli.ts risk --warn-within 10 --json
```

The TypeScript example pins the actually published `@suwappu/sdk@0.4.0`. The source repository contains newer SDK code; this README does not imply that source has been published to npm.

## Python quick start

The Suwappu Python SDK is source-only today; it is not published on PyPI. `requirements.txt` pins a known core commit instead of pretending a registry release exists.

```bash
python -m pip install -r requirements.txt
export SUWAPPU_API_KEY=suwappu_sk_...
export HL_ADDRESS=0x1111111111111111111111111111111111111111

python trader.py markets --top 5
python trader.py quote --market SOL-USD --side long --size 1 --leverage 3
python trader.py positions
python trader.py risk --warn-within 10 --json
```

The Python and TypeScript `risk --json` commands intentionally use the same camelCase snapshot keys so a downstream product does not need two schemas.

## What `risk` computes

For each reported open position:

- `notionalUsd = abs(size) * markPrice`;
- `pnlOnMarginPct = unrealizedPnl / margin * 100` when margin is positive;
- long liquidation buffer: `(markPrice - liquidationPrice) / markPrice * 100`;
- short liquidation buffer: `(liquidationPrice - markPrice) / markPrice * 100`;
- leverage utilization relative to the returned market `maxLeverage` when metadata is available.

`liquidationPrice: 0` from the Suwappu positions path means unavailable, so the snapshot returns `null` for the derived buffer and emits a warning. A non-positive directional buffer is also a warning rather than being silently normalized.

`--warn-within` is your product rule, not a Suwappu recommendation. For example, `--warn-within 10` flags a reported liquidation buffer at or below 10%.

```bash
bun src/cli.ts risk \
  --address 0x1111111111111111111111111111111111111111 \
  --warn-within 10 \
  --json
```

The snapshot is computed from two independent API reads (`positions` and `markets`). `computedAt` is the client computation time, not an exchange observation timestamp. Do not treat the composed object as an atomic venue snapshot.

## Quote contract and leverage

Before requesting a quote, both CLIs fetch the current market list and validate the requested market, size, side, and leverage. The current Suwappu quote route also has a 20x request ceiling, so the example uses the lower of that ceiling and the returned market maximum.

That distinction matters when a venue advertises a higher maximum: a venue maximum is not automatically a promise that Suwappu's current quote route accepts the same value.

The quote remains read-only. `size` is the base-asset position size expected by the perps market, not a generic “USD to spend” field. The quote uses an indicative midpoint and an approximate liquidation model; it does not model order-book depth, slippage, or a guaranteed fill.

## Current limitations

- Suwappu's current perps Agent API has no open/close/order endpoint.
- `fundingRate` is currently a placeholder `0` on these Suwappu perps paths; do not build funding alerts from it.
- There is no streaming perps surface here; each command is a request/response snapshot.
- A derived liquidation buffer is monitoring data, not a liquidation guarantee.
- `risk` does not persist alert state, deduplicate notifications, or implement hysteresis. Those belong in the product layer; see [`BUILDING_A_PRODUCT.md`](BUILDING_A_PRODUCT.md).

## Suwappu vs direct Hyperliquid OSS

Use the narrow tool that matches your authority needs.

| Need | This Suwappu example | Direct Hyperliquid integration |
|---|---|---|
| Read/quote boundary for an agent | Strong fit | Possible, but you own more venue-specific surface |
| Hosted MCP tools | Built in | Build/host your own adapter |
| TypeScript + source-pinned Python examples | Yes | Official Python SDK is the reference SDK |
| Lowest-latency realtime data | No streaming here | Use Hyperliquid WebSocket APIs |
| Full venue trading/signing | Intentionally absent | Use Hyperliquid's exchange API/SDK |
| Venue-specific features and fastest feature parity | Narrow by design | Direct integration wins |

Hyperliquid's [official API docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api) point builders to its [official Python SDK](https://github.com/hyperliquid-dex/hyperliquid-python-sdk), which includes trading examples and venue-native credentials. Hyperliquid also documents [WebSocket APIs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket) for realtime data.

That is the honest tradeoff: choose direct Hyperliquid when you need complete venue control or streaming. Choose this Suwappu boundary when you want a smaller agent-facing research surface, hosted MCP, and an explicit separation from execution authority.

## Turn it into a product

The monetizable layer is not “a bot that trades.” It is the workflow you add around trustworthy reads:

1. free market/position explorer;
2. paid liquidation-risk and P&L alerts;
3. multi-wallet risk workspace with alert history and ownership controls;
4. team/API plan with webhooks, exports, and service-level monitoring;
5. optional execution handoff as a separate, explicitly authorized integration.

See [`BUILDING_A_PRODUCT.md`](BUILDING_A_PRODUCT.md) for alert state, request economics, gross-margin math, and the direct-venue boundary.

## JSON output

All four commands support `--json`:

```bash
bun src/cli.ts markets --top 5 --json
bun src/cli.ts quote --market ETH-USD --leverage 3 --json
bun src/cli.ts positions --json
bun src/cli.ts risk --warn-within 10 --json
```

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SUWAPPU_API_KEY` | Yes | Suwappu agent authentication |
| `HL_ADDRESS` | No | Default address for `positions` and `risk` |

## Develop

```bash
bun run check
bun test
python -m py_compile trader.py risk.py
python -m unittest discover -s tests -p 'test_*.py'
```

CI pins Bun, typechecks the TypeScript CLI, runs the real TypeScript/Python risk tests, installs/imports the pinned Python SDK, and keeps credentials out of the workflow.

## Build further

- [Suwappu docs](https://docs.suwappu.bot)
- [Perps guide](https://docs.suwappu.bot/guides/perps-trading)
- [TypeScript SDK source](https://github.com/0xSoftBoi/suwappubot/tree/main/packages/sdk)
- [Python SDK source](https://github.com/0xSoftBoi/suwappubot/tree/main/packages/sdk-python)

## License

MIT
