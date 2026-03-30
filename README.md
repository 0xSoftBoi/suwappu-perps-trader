# suwappu-perps-trader

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://python.org)

Browse perpetual futures markets, quote leveraged positions, and track PnL using [Suwappu](https://suwappu.bot) DEX + HyperLiquid.

> **Warning**: Perpetual futures involve leverage and liquidation risk. Use small positions and understand the risks before trading.

## Install

```bash
bun install  # or npm install
```

## Usage

```bash
export SUWAPPU_API_KEY=suwappu_sk_...

# List markets
bun run src/cli.ts markets
bun run src/cli.ts markets --top 5 --json

# Quote a position
bun run src/cli.ts quote --market ETH-USD --side long --size 1 --leverage 10
bun run src/cli.ts quote --market BTC-USD --side short --leverage 3 --json

# Check positions
bun run src/cli.ts positions --address 0xYourHL...

# Python
python trader.py markets --top 5
python trader.py quote --market SOL-USD --leverage 5
python trader.py positions --address 0x...
```

## Commands

| Command | Description |
|---------|-------------|
| `markets` | List available perpetual futures markets |
| `quote` | Get entry/liquidation/margin for a position |
| `positions` | Show open positions with PnL |

## Example Output

```
$ bun run src/cli.ts markets --top 5

Perpetual Futures Markets

  Market       Mark Price      Max Lev   Funding Rate
  ───────────────────────────────────────────────────────
  BTC-USD      $66,637         40x       0.0000%
  ETH-USD      $2,003          20x       0.0012%
  SOL-USD      $82             20x       -0.0005%
  ARB-USD      $0.85           20x       0.0003%
  AVAX-USD     $24             20x       0.0001%
```

```
$ bun run src/cli.ts quote --market ETH-USD --side long --size 1 --leverage 10

1 ETH-USD LONG @ 10x

  Entry Price:       $2,003
  Margin Required:   $200.30
  Liquidation Price: $1,823.00
  Fee:               $1.20
  Funding Rate:      0.0012%
```

## Development

```bash
bun test && bun run check
```

## Links

- [Suwappu Docs](https://docs.suwappu.bot) | [Perps Guide](https://docs.suwappu.bot/guides/perps-trading)

## License

MIT
