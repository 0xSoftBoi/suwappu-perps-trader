#!/usr/bin/env python3
"""Minimal Python SDK companion for the standalone Suwappu perps risk monitor."""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import sys

from risk import PositionInput, build_risk_snapshot, validate_warning_threshold
from suwappu import create_client


SUWAPPU_QUOTE_MAX_LEVERAGE = 20.0


def require_api_key() -> str:
    value = os.environ.get("SUWAPPU_API_KEY")
    if not value:
        raise RuntimeError("SUWAPPU_API_KEY is not set")
    if value != value.strip():
        raise RuntimeError("SUWAPPU_API_KEY must not contain leading or trailing whitespace")
    return value


def safe_error_message(error: Exception) -> str:
    status = getattr(error, "status", None)
    if isinstance(status, int):
        return f"Suwappu API request failed with HTTP {status}"
    if isinstance(error, (ValueError, RuntimeError)):
        return str(error)
    return type(error).__name__


def resolve_address(value: str | None) -> str:
    address = value or os.environ.get("HL_ADDRESS")
    if not address:
        raise ValueError("--address is required unless HL_ADDRESS is set")
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", address):
        raise ValueError("HyperLiquid address must be a 0x-prefixed 20-byte address")
    return address


def effective_quote_max_leverage(market_max_leverage: float) -> float:
    if not math.isfinite(market_max_leverage) or market_max_leverage <= 0:
        raise ValueError("No valid leverage limit returned for market")
    return min(market_max_leverage, SUWAPPU_QUOTE_MAX_LEVERAGE)


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
        quote_max_leverage = effective_quote_max_leverage(market.max_leverage)
        if args.leverage > quote_max_leverage:
            raise ValueError(
                f"{market.name} supports at most {quote_max_leverage:g}x leverage on the "
                "current Suwappu quote route; "
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
    address = resolve_address(args.address)
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


async def cmd_risk(args: argparse.Namespace) -> None:
    address = resolve_address(args.address)
    warn_within_pct = validate_warning_threshold(args.warn_within)
    client = create_client(api_key=require_api_key())
    try:
        positions, markets = await asyncio.gather(
            client.perps.positions(address),
            client.perps.markets(),
        )
        snapshot = build_risk_snapshot(
            address=address,
            positions=[
                PositionInput(
                    id=position.id,
                    market=position.market,
                    side=position.side,
                    size=position.size,
                    leverage=position.leverage,
                    entry_price=position.entry_price,
                    mark_price=position.mark_price,
                    margin=position.margin,
                    unrealized_pnl=position.unrealized_pnl,
                    liquidation_price=position.liquidation_price,
                    funding_rate=position.funding_rate,
                )
                for position in positions
            ],
            market_max_by_name={
                market.name: market.max_leverage for market in markets
            },
            warn_within_pct=warn_within_pct,
        )

        if args.json:
            print(json.dumps(snapshot, indent=2))
            return

        totals = snapshot["totals"]
        print("\nPerps Risk Snapshot\n")
        print(f"  Address:        {snapshot['address']}")
        print(f"  Positions:      {snapshot['positionCount']}")
        print(f"  Notional:       ${totals['notionalUsd']:.2f}")
        print(f"  Margin:         ${totals['marginUsd']:.2f}")
        print(f"  Unrealized PnL: ${totals['unrealizedPnlUsd']:.2f}")
        print(f"  Warnings:       {snapshot['warningCount']}")
        for position in snapshot["positions"]:
            distance = position["liquidationDistancePct"]
            buffer = "n/a" if distance is None else f"{distance:.2f}%"
            print(
                f"\n  {position['market']} {position['side'].upper()} | "
                f"liquidation buffer {buffer} | {position['leverage']}x"
            )
            for warning in position["warnings"]:
                print(f"    ! {warning}")
    finally:
        await client.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read-only Suwappu perps SDK companion"
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

    risk = sub.add_parser("risk", help="Build a read-only position-risk snapshot")
    risk.add_argument("--address", help="defaults to HL_ADDRESS")
    risk.add_argument(
        "--warn-within",
        type=float,
        default=10.0,
        help="warn at or below this reported liquidation-buffer percentage",
    )
    risk.add_argument("--json", action="store_true")

    args = parser.parse_args()
    fn = {
        "markets": cmd_markets,
        "quote": cmd_quote,
        "positions": cmd_positions,
        "risk": cmd_risk,
    }[args.command]

    try:
        asyncio.run(fn(args))
    except Exception as error:
        print(f"Error: {safe_error_message(error)}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
