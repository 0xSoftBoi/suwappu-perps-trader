# Suwappu Perps Explorer

A read-only perpetual-futures example for builders using [Suwappu](https://suwappu.bot).

The repository is named `suwappu-perps-trader` for compatibility, but its code deliberately exposes only market discovery, position quoting, and position reads. It has no order-placement command and cannot open or close a leveraged position.

> Perpetual futures involve leverage, funding, and liquidation risk. A quote is analysis, not a recommendation or an executed trade.

## Builder surface

| CLI command | TypeScript SDK | Hosted MCP tool | Side effect |
|---|---|---|---|
| `markets` | `client.perps.markets()` | `perps_markets` | read-only |
| `quote` | `client.perps.quote(...)` | `perps_quote` | read-only |
| `positions` | `client.perps.positions(address)` | `perps_positions` | read-only |

Hosted MCP endpoint: `https://api.suwappu.bot/mcp`.

A perps quote reports estimated entry price, margin, liquidation price, funding, and fees. It does **not** create a position.

## TypeScript quick start

```bash
git clone https://github.com/0xSoftBoi/suwappu-perps-trader.git
cd suwappu-perps-trader
bun install

export SUWAPPU_API_KEY=suwappu_sk_...

bun src/cli.ts markets --top 5
bun src/cli.ts quote --market ETH-USD --side long --size 1 --leverage 5
bun src/cli.ts positions --address 0x1111111111111111111111111111111111111111
```

The TypeScript example uses the actually published `@suwappu/sdk@0.4.0` perps read/quote methods.

Before requesting a quote, the CLI fetches the current market list and rejects leverage above that market's returned `maxLeverage`. It also rejects non-positive size/leverage and unknown markets.

## Python quick start

The Suwappu Python SDK is source-only today; it is not published on PyPI. This repository pins the current SDK source commit in `requirements.txt`:

```bash
python -m pip install -r requirements.txt
export SUWAPPU_API_KEY=suwappu_sk_...

python trader.py markets --top 5
python trader.py quote --market SOL-USD --side long --size 1 --leverage 3
python trader.py positions --address 0x1111111111111111111111111111111111111111
```

That makes the Python example installable without pretending a `suwappu` PyPI release exists.

## Commands

### Markets

```bash
bun src/cli.ts markets
bun src/cli.ts markets --top 5 --json
```

Use the returned market names and `maxLeverage` values as runtime data. Do not hard-code a universal leverage ceiling.

### Quote

```bash
bun src/cli.ts quote \
  --market ETH-USD \
  --side short \
  --size 0.5 \
  --leverage 3
```

The quote remains read-only. `size` is the position size expected by the perps market—not a generic “USD to spend” field—so inspect the returned margin and fee before building any downstream trading workflow.

### Positions

```bash
export HL_ADDRESS=0x1111111111111111111111111111111111111111
bun src/cli.ts positions

# Explicit flag wins when supplied.
bun src/cli.ts positions --address 0x2222222222222222222222222222222222222222
```

The address must be a 0x-prefixed 20-byte address.

## Current SDK status

The npm SDK is currently 0.4.0; the Suwappu repository contains newer 0.6 TypeScript source with a broader agent control plane. This example does not claim the newer source has been published.

For perps specifically, the builder surface in this repository is intentionally narrow and stable: list markets, obtain a quote, and inspect positions. If Suwappu adds position execution later, treat that as a separate destructive capability with an explicit permission boundary—do not silently turn this quote command into an order command.

## JSON output

All three commands support `--json`, making the example useful as a small data adapter for agents and scripts:

```bash
bun src/cli.ts markets --top 5 --json
bun src/cli.ts quote --market ETH-USD --leverage 3 --json
bun src/cli.ts positions --json
```

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SUWAPPU_API_KEY` | Yes | Suwappu agent authentication |
| `HL_ADDRESS` | No | Default address for `positions` |

## Develop

```bash
bun run check
bun test
python -m py_compile trader.py
```

CI installs the pinned Python SDK, imports it, typechecks the TypeScript CLI, and runs the validation tests.

## Build further

- [Suwappu docs](https://docs.suwappu.bot)
- [Perps guide](https://docs.suwappu.bot/guides/perps-trading)
- [TypeScript SDK source](https://github.com/0xSoftBoi/suwappubot/tree/main/packages/sdk)
- [Python SDK source](https://github.com/0xSoftBoi/suwappubot/tree/main/packages/sdk-python)

## License

MIT
