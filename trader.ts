import { createClient } from "@suwappu/sdk";
const client = createClient({ apiKey: process.env.SUWAPPU_API_KEY });

console.log("Available perpetual markets:\n");
const markets = await client.perps.markets();
for (const m of markets) console.log(`  ${m.name} — $${m.markPrice.toLocaleString()} | Max ${m.maxLeverage}x | Funding: ${(m.fundingRate * 100).toFixed(4)}%`);

console.log("\nQuoting 1 ETH long at 5x leverage...");
const quote = await client.perps.quote("ETH-USD", "long", 1, 5);
console.log(`  Entry: $${quote.entryPrice.toLocaleString()} | Margin: $${quote.margin.toFixed(2)} | Liq: $${quote.liquidationPrice.toFixed(2)} | Fee: $${quote.fee.toFixed(2)}`);

const addr = process.env.HL_ADDRESS;
if (addr) { const pos = await client.perps.positions(addr); console.log(`\nPositions: ${pos.length || "none"}`); for (const p of pos) console.log(`  ${p.market} ${p.side.toUpperCase()} ${p.size} @ $${p.entryPrice} | PnL: ${p.unrealizedPnl >= 0 ? "+" : ""}$${p.unrealizedPnl.toFixed(2)}`); }
else console.log("\nSet HL_ADDRESS to check positions");
