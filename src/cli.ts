#!/usr/bin/env bun
import { Command } from "commander";
import { createClient } from "@suwappu/sdk";
import { buildRiskSnapshot, validateWarningThreshold } from "./risk.js";
import {
  effectiveQuoteMaxLeverage,
  positiveInteger,
  validateAddress,
  validatePerpsQuote,
} from "./validation.js";

function requireApiKey(): string {
  const value = process.env.SUWAPPU_API_KEY;
  if (!value) {
    throw new Error(
      "SUWAPPU_API_KEY is not set. Register an agent at https://api.suwappu.bot/v1/agent/register",
    );
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveAddress(value: string | undefined): string {
  const rawAddress = value ?? process.env.HL_ADDRESS;
  if (!rawAddress) {
    throw new Error("--address is required unless HL_ADDRESS is set");
  }
  return validateAddress(rawAddress);
}

const program = new Command()
  .name("suwappu-perps-trader")
  .description("Read-only Suwappu perps market, quote, position, and risk explorer")
  .version("1.0.0");

program
  .command("markets")
  .description("List available perpetual markets")
  .option("--top <n>", "show top N markets", Number.parseInt, 10)
  .option("--json", "JSON output")
  .action(async (opts) => {
    const topN = positiveInteger(opts.top, "--top");
    const client = createClient({ apiKey: requireApiKey() });
    const markets = (await client.perps.markets()).slice(0, topN);

    if (opts.json) {
      console.log(JSON.stringify(markets, null, 2));
      return;
    }

    console.log("Perpetual Futures Markets\n");
    console.log("  Market       Mark Price      Max Lev   Funding Rate");
    console.log("  " + "─".repeat(55));
    for (const market of markets) {
      console.log(
        `  ${market.name.padEnd(13)}$${market.markPrice.toLocaleString().padEnd(16)}${market.maxLeverage}x`.padEnd(
          42,
        ) + `${(market.fundingRate * 100).toFixed(4)}%`,
      );
    }
  });

program
  .command("quote")
  .description("Get a read-only leveraged-position quote; never opens a position")
  .option("--market <name>", "market symbol", "ETH-USD")
  .option("--side <side>", "long or short", "long")
  .option("--size <n>", "position size", Number.parseFloat, 1)
  .option("--leverage <n>", "leverage multiplier", Number.parseFloat, 5)
  .option("--json", "JSON output")
  .action(async (opts) => {
    const client = createClient({ apiKey: requireApiKey() });
    const markets = await client.perps.markets();
    const market = markets.find(
      (candidate) => candidate.name.toLowerCase() === opts.market.toLowerCase(),
    );
    if (!market) {
      throw new Error(
        `Unknown perps market "${opts.market}". Run "markets" to list available markets.`,
      );
    }

    const side = validatePerpsQuote({
      market: market.name,
      side: opts.side,
      size: opts.size,
      leverage: opts.leverage,
      maxLeverage: effectiveQuoteMaxLeverage(market.maxLeverage),
    });
    const quote = await client.perps.quote(
      market.name,
      side,
      opts.size,
      opts.leverage,
    );

    if (opts.json) {
      console.log(JSON.stringify(quote, null, 2));
      return;
    }

    console.log(
      `\n${opts.size} ${market.name} ${side.toUpperCase()} @ ${opts.leverage}x\n`,
    );
    console.log("  Read-only quote — no position is opened.");
    console.log(`  Entry Price:       $${quote.entryPrice.toLocaleString()}`);
    console.log(`  Margin Required:   $${quote.margin.toFixed(2)}`);
    console.log(`  Liquidation Price: $${quote.liquidationPrice.toFixed(2)}`);
    console.log(`  Fee:               $${quote.fee.toFixed(2)}`);
    console.log(`  Funding Rate:      ${(quote.fundingRate * 100).toFixed(4)}%`);
  });

program
  .command("positions")
  .description("Read open positions for an address")
  .option("--address <addr>", "HyperLiquid address; defaults to HL_ADDRESS")
  .option("--json", "JSON output")
  .action(async (opts) => {
    const address = resolveAddress(opts.address);
    const client = createClient({ apiKey: requireApiKey() });
    const positions = await client.perps.positions(address);

    if (opts.json) {
      console.log(JSON.stringify(positions, null, 2));
      return;
    }
    if (!positions.length) {
      console.log("No open positions.");
      return;
    }

    console.log("\nOpen Positions\n");
    for (const position of positions) {
      const pnl =
        position.unrealizedPnl >= 0
          ? `+$${position.unrealizedPnl.toFixed(2)}`
          : `-$${Math.abs(position.unrealizedPnl).toFixed(2)}`;
      console.log(
        `  ${position.market} ${position.side.toUpperCase()} ${position.size} @ $${position.entryPrice} → $${position.markPrice} | ${position.leverage}x | PnL: ${pnl}`,
      );
    }
  });

program
  .command("risk")
  .description("Build a read-only position-risk snapshot for alerts and dashboards")
  .option("--address <addr>", "HyperLiquid address; defaults to HL_ADDRESS")
  .option(
    "--warn-within <pct>",
    "warn when the reported liquidation buffer is at or below this percentage",
    Number.parseFloat,
    10,
  )
  .option("--json", "JSON output")
  .action(async (opts) => {
    const address = resolveAddress(opts.address);
    const warnWithinPct = validateWarningThreshold(opts.warnWithin);
    const client = createClient({ apiKey: requireApiKey() });
    const [positions, markets] = await Promise.all([
      client.perps.positions(address),
      client.perps.markets(),
    ]);
    const snapshot = buildRiskSnapshot({ address, positions, markets, warnWithinPct });

    if (opts.json) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    console.log("\nPerps Risk Snapshot\n");
    console.log(`  Address:       ${snapshot.address}`);
    console.log(`  Positions:     ${snapshot.positionCount}`);
    console.log(`  Notional:      $${snapshot.totals.notionalUsd.toFixed(2)}`);
    console.log(`  Margin:        $${snapshot.totals.marginUsd.toFixed(2)}`);
    console.log(`  Unrealized PnL: $${snapshot.totals.unrealizedPnlUsd.toFixed(2)}`);
    console.log(`  Warnings:      ${snapshot.warningCount}`);

    for (const position of snapshot.positions) {
      const buffer =
        position.liquidationDistancePct === null
          ? "n/a"
          : `${position.liquidationDistancePct.toFixed(2)}%`;
      console.log(
        `\n  ${position.market} ${position.side.toUpperCase()} | liquidation buffer ${buffer} | ${position.leverage}x`,
      );
      for (const warning of position.warnings) {
        console.log(`    ! ${warning}`);
      }
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`Error: ${errorMessage(error)}`);
  process.exitCode = 1;
});
