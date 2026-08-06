#!/usr/bin/env python3
"""Read-only Suwappu perps market, quote, and position explorer."""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import sys

from suwappu import create_client


def require_api_key() -> str:
    value = os.environ.get("SUWAPPU_API_KEY")
    if not value:
        raise RuntimeError("SUWAPPU_API_KEY is not set")
    return value


async def cmd_markets(args: argparse.Namespace) -> None:
    if args.top <= 0:
        raise ValueError("--top must be a positive integer")

    client = create_client(api_key=require_api_key())
    try:
        markets = (await client.perps.markets())[: args.top]
        if args.json:
            print(json.dumps([market.model_dump() for market in markets], indent=2))
            return

        print("Perpetual Futures Markets\n")
        print("  Market       Mark Price      Max Lev   Funding Rate")
        print("  " + "─" * 55)
        for market in markets:
            print(
                f"  {market.name:<13}${market.mark_price:>14,.0f}  "
                f"{market.max_leverage:>6}x     {market.funding_rate * 100:.4f}%"
            )
    finally:
        await client.close()


async def cmd_quote(args: argparse.Namespace) -> None:
    if not math.isfinite(args.size) or args.size <= 0:
        raise ValueError("--size must be positive")
    if not math.isfinite(args.leverage) or args.leverage < 1:
        raise ValueError("--leverage must be at least 1")

    client = create_client(api_key=require_api_key())
    try:
        markets = await client.perps.markets()
        market = next(
            (
                candidate
                for candidate in markets
                if candidate.name.lower() == args.market.lower()
            ),
            None,
        )
        if market is None:
            raise ValueError(
                f'Unknown perps market "{args.market}". Run "markets" first.'
            )
        if args.leverage > market.max_leverage:
            raise ValueError(
                f"{market.name} supports at most {market.max_leverage}x leverage; "
                f"requested {args.leverage}x"
            )

        quote = await client.perps.quote(
            market.name,
            args.side,
            args.size,
            args.leverage,
        )
        if args.json:
            print(json.dumps(quote.model_dump(), indent=2))
            return

        print(
            f"\n{args.size} {market.name} {args.side.upper()} "
            f"@ {args.leverage}x\n"
        )
        print("  Read-only quote — no position is opened.")
        print(f"  Entry:       ${quote.entry_price:,.2f}")
        print(f"  Margin:      ${quote.margin:.2f}")
        print(f"  Liquidation: ${quote.liquidation_price:.2f}")
        print(f"  Fee:         ${quote.fee:.2f}")
        print(f"  Funding:     {quote.funding_rate * 100:.4f}%")
    finally:
        await client.close()


async def cmd_positions(args: argparse.Namespace) -> None:
    address = args.address or os.environ.get("HL_ADDRESS")
    if not address:
        raise ValueError("--address is required unless HL_ADDRESS is set")
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", address):
        raise ValueError("HyperLiquid address must be a 0x-prefixed 20-byte address")

    client = create_client(api_key=require_api_key())
    try:
        positions = await client.perps.positions(address)
        if args.json:
            print(json.dumps([position.model_dump() for position in positions], indent=2))
            return
        if not positions:
            print("No open positions.")
            return

        print("\nOpen Positions\n")
        for position in positions:
            sign = "+" if position.unrealized_pnl >= 0 else ""
            print(
                f"  {position.market} {position.side.upper()} {position.size} "
                f"@ ${position.entry_price} | {position.leverage}x | "
                f"PnL: {sign}${position.unrealized_pnl:.2f}"
            )
    finally:
        await client.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read-only Suwappu perps explorer"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    markets = sub.add_parser("markets", help="List perpetual markets")
    markets.add_argument("--top", type=int, default=10)
    markets.add_argument("--json", action="store_true")

    quote = sub.add_parser("quote", help="Get a read-only leveraged-position quote")
    quote.add_argument("--market", default="ETH-USD")
    quote.add_argument("--side", choices=["long", "short"], default="long")
    quote.add_argument("--size", type=float, default=1.0)
    quote.add_argument("--leverage", type=float, default=5.0)
    quote.add_argument("--json", action="store_true")

    positions = sub.add_parser("positions", help="Read open positions")
    positions.add_argument("--address", help="defaults to HL_ADDRESS")
    positions.add_argument("--json", action="store_true")

    args = parser.parse_args()
    fn = {
        "markets": cmd_markets,
        "quote": cmd_quote,
        "positions": cmd_positions,
    }[args.command]

    try:
        asyncio.run(fn(args))
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
