#!/usr/bin/env python3
"""Suwappu Perps Trader — browse markets, quote positions, check PnL."""
import argparse, asyncio, json, os, re, sys
from suwappu import create_client

def require_env(name):
    val = os.environ.get(name)
    if not val:
        print(f"Error: {name} not set", file=sys.stderr)
        sys.exit(1)
    return val

async def cmd_markets(args):
    c = create_client(api_key=require_env("SUWAPPU_API_KEY"))
    markets = await c.perps.markets()
    top = markets[:args.top]
    if args.json:
        print(json.dumps([m.model_dump() for m in top], indent=2)); await c.close(); return
    print("Perpetual Futures Markets\n")
    print("  Market       Mark Price      Max Lev   Funding Rate")
    print("  " + "─" * 55)
    for m in top:
        print(f"  {m.name:<13}${m.mark_price:>14,.0f}  {m.max_leverage:>6}x     {m.funding_rate*100:.4f}%")
    await c.close()

async def cmd_quote(args):
    c = create_client(api_key=require_env("SUWAPPU_API_KEY"))
    q = await c.perps.quote(args.market, args.side, args.size, args.leverage)
    if args.json:
        print(json.dumps(q.model_dump(), indent=2)); await c.close(); return
    print(f"\n{args.size} {args.market} {args.side.upper()} @ {args.leverage}x\n")
    print(f"  Entry:       ${q.entry_price:,.2f}")
    print(f"  Margin:      ${q.margin:.2f}")
    print(f"  Liquidation: ${q.liquidation_price:.2f}")
    print(f"  Fee:         ${q.fee:.2f}")
    await c.close()

async def cmd_positions(args):
    c = create_client(api_key=require_env("SUWAPPU_API_KEY"))
    pos = await c.perps.positions(args.address)
    if args.json:
        print(json.dumps([p.model_dump() for p in pos], indent=2)); await c.close(); return
    if not pos: print("No open positions."); await c.close(); return
    for p in pos:
        sign = "+" if p.unrealized_pnl >= 0 else ""
        print(f"  {p.market} {p.side.upper()} {p.size} @ ${p.entry_price} | PnL: {sign}${p.unrealized_pnl:.2f}")
    await c.close()

def main():
    p = argparse.ArgumentParser(description="Suwappu Perps Trader")
    sub = p.add_subparsers(dest="command", required=True)
    
    m = sub.add_parser("markets", help="List perpetual markets")
    m.add_argument("--top", type=int, default=10)
    m.add_argument("--json", action="store_true")
    
    q = sub.add_parser("quote", help="Quote a leveraged position")
    q.add_argument("--market", default="ETH-USD")
    q.add_argument("--side", choices=["long","short"], default="long")
    q.add_argument("--size", type=float, default=1.0)
    q.add_argument("--leverage", type=float, default=5.0)
    q.add_argument("--json", action="store_true")
    
    ps = sub.add_parser("positions", help="Check open positions")
    ps.add_argument("--address", required=True)
    ps.add_argument("--json", action="store_true")
    
    args = p.parse_args()

    if hasattr(args, 'leverage'):
        MAX_LEVERAGE = float(os.environ.get("MAX_LEVERAGE", "20"))
        if args.leverage <= 0 or args.leverage > MAX_LEVERAGE:
            print(f"Error: leverage must be between 1 and {MAX_LEVERAGE}x")
            sys.exit(1)

    if hasattr(args, 'address') and args.address and not re.match(r'^0x[a-fA-F0-9]{40}$', args.address):
        print(f"Error: invalid Ethereum address format: {args.address}")
        sys.exit(1)

    fn = {"markets": cmd_markets, "quote": cmd_quote, "positions": cmd_positions}[args.command]
    asyncio.run(fn(args))

if __name__ == "__main__": main()
