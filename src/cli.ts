#!/usr/bin/env bun
import { Command } from "commander";
import { createClient } from "@suwappu/sdk";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) { console.error(`Error: ${name} not set`); if (name === "SUWAPPU_API_KEY") console.error('  Get one: curl -X POST https://api.suwappu.bot/v1/agent/register -H "Content-Type: application/json" -d \'{"name":"my-agent"}\''); process.exit(1); }
  return val;
}

const program = new Command()
  .name("suwappu-perps-trader")
  .description("Browse perpetual futures markets, quote leveraged positions, and track PnL")
  .version("1.0.0");

program.command("markets").description("List available perpetual markets")
  .option("--top <n>", "show top N markets", parseInt, 10)
  .option("--json", "JSON output")
  .action(async (opts) => {
    const client = createClient({ apiKey: requireEnv("SUWAPPU_API_KEY") });
    try {
      const markets = await client.perps.markets();
      const top = markets.slice(0, opts.top);
      if (opts.json) { console.log(JSON.stringify(top, null, 2)); return; }
      console.log("Perpetual Futures Markets\n");
      console.log("  Market       Mark Price      Max Lev   Funding Rate");
      console.log("  " + "─".repeat(55));
      for (const m of top) {
        console.log(`  ${m.name.padEnd(13)}$${m.markPrice.toLocaleString().padEnd(16)}${m.maxLeverage}x`.padEnd(42) + `${(m.fundingRate * 100).toFixed(4)}%`);
      }
    } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
  });

program.command("quote").description("Get a leveraged position quote")
  .option("--market <name>", "market symbol", "ETH-USD")
  .option("--side <side>", "long or short", "long")
  .option("--size <n>", "position size", parseFloat, 1)
  .option("--leverage <n>", "leverage multiplier", parseFloat, 5)
  .option("--json", "JSON output")
  .action(async (opts) => {
    const client = createClient({ apiKey: requireEnv("SUWAPPU_API_KEY") });
    try {
      const q = await client.perps.quote(opts.market, opts.side, opts.size, opts.leverage);
      if (opts.json) { console.log(JSON.stringify(q, null, 2)); return; }
      console.log(`\n${opts.size} ${opts.market} ${opts.side.toUpperCase()} @ ${opts.leverage}x\n`);
      console.log(`  Entry Price:       $${q.entryPrice.toLocaleString()}`);
      console.log(`  Margin Required:   $${q.margin.toFixed(2)}`);
      console.log(`  Liquidation Price: $${q.liquidationPrice.toFixed(2)}`);
      console.log(`  Fee:               $${q.fee.toFixed(2)}`);
      console.log(`  Funding Rate:      ${(q.fundingRate * 100).toFixed(4)}%`);
    } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
  });

program.command("positions").description("Check open positions")
  .requiredOption("--address <addr>", "HyperLiquid address")
  .option("--json", "JSON output")
  .action(async (opts) => {
    const client = createClient({ apiKey: requireEnv("SUWAPPU_API_KEY") });
    try {
      const positions = await client.perps.positions(opts.address);
      if (opts.json) { console.log(JSON.stringify(positions, null, 2)); return; }
      if (!positions.length) { console.log("No open positions."); return; }
      console.log("\nOpen Positions\n");
      for (const p of positions) {
        const pnl = p.unrealizedPnl >= 0 ? `+$${p.unrealizedPnl.toFixed(2)}` : `-$${Math.abs(p.unrealizedPnl).toFixed(2)}`;
        console.log(`  ${p.market} ${p.side.toUpperCase()} ${p.size} @ $${p.entryPrice} → $${p.markPrice} | ${p.leverage}x | PnL: ${pnl}`);
      }
    } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
  });

program.parseAsync();
