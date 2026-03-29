#!/usr/bin/env python3
"""Suwappu Perps Trader — browse markets, quote positions, check PnL."""
import asyncio, os
from suwappu import create_client

async def main():
    c = create_client(api_key=os.environ.get("SUWAPPU_API_KEY", ""))
    print("Available perpetual markets:\n")
    for m in await c.perps.markets():
        print(f"  {m.name} — ${m.mark_price:,.0f} | Max {m.max_leverage}x | Funding: {m.funding_rate*100:.4f}%")
    q = await c.perps.quote("ETH-USD", "long", 1.0, 5.0)
    print(f"\n1 ETH long 5x: Entry ${q.entry_price:,.2f} | Margin ${q.margin:.2f} | Liq ${q.liquidation_price:.2f}")
    addr = os.environ.get("HL_ADDRESS")
    if addr:
        for p in await c.perps.positions(addr):
            print(f"  {p.market} {p.side.upper()} {p.size} @ ${p.entry_price} | PnL: {'+'if p.unrealized_pnl>=0 else ''}${p.unrealized_pnl:.2f}")
    await c.close()

asyncio.run(main())
