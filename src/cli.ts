#!/usr/bin/env bun
import { Command } from "commander";
import { perpsApi } from "./api.js";
import { buildRiskSnapshot, validateWarningThreshold } from "./risk.js";
import { acquireStateLock, loadWatchState, saveWatchState } from "./state.js";
import {
  effectiveQuoteMaxLeverage,
  positiveInteger,
  validateAddress,
  validatePerpsQuote,
} from "./validation.js";
import { evaluateWatch, validateWatchRule } from "./watch.js";

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected failure";
}

function resolveAddress(value: string | undefined): string {
  const rawAddress = value ?? process.env.HL_ADDRESS;
  if (!rawAddress) throw new Error("--address is required unless HL_ADDRESS is set");
  return validateAddress(rawAddress);
}

async function snapshotFor(address: string, warnWithinPct: number) {
  const [positions, markets] = await Promise.all([
    perpsApi.positions(address),
    perpsApi.markets(),
  ]);
  return buildRiskSnapshot({ address, positions, markets, warnWithinPct });
}

function printRiskSnapshot(snapshot: ReturnType<typeof buildRiskSnapshot>): void {
  console.log("\nPerps Risk Snapshot\n");
  console.log(`  Address:        ${snapshot.address}`);
  console.log(`  Positions:      ${snapshot.positionCount}`);
  console.log(`  Notional:       $${snapshot.totals.notionalUsd.toFixed(2)}`);
  console.log(`  Margin:         $${snapshot.totals.marginUsd.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${snapshot.totals.unrealizedPnlUsd.toFixed(2)}`);
  console.log(`  Warnings:       ${snapshot.warningCount}`);
  for (const position of snapshot.positions) {
    const buffer =
      position.liquidationDistancePct === null
        ? "n/a"
        : `${position.liquidationDistancePct.toFixed(2)}%`;
    console.log(
      `\n  ${position.market} ${position.side.toUpperCase()} | liquidation buffer ${buffer} | ${position.leverage}x`,
    );
    for (const warning of position.warnings) console.log(`    ! ${warning}`);
  }
}

const program = new Command()
  .name("suwappu-perps")
  .description("Standalone read-only Suwappu perpetual-futures risk monitor")
  .version("2.0.0");

program
  .command("markets")
  .description("List supported perpetual markets; no API key required")
  .option("--top <n>", "show top N markets", Number, 10)
  .option("--json", "JSON output")
  .action(async (opts) => {
    const topN = positiveInteger(opts.top, "--top");
    const markets = (await perpsApi.markets()).slice(0, topN);
    if (opts.json) {
      console.log(JSON.stringify(markets, null, 2));
      return;
    }
    console.log("Perpetual Futures Markets\n");
    console.log("  Market       Mark Price      Quote Max   Venue Max   Funding Rate");
    console.log("  " + "─".repeat(72));
    for (const market of markets) {
      console.log(
        `  ${market.name.padEnd(13)}$${market.markPrice.toLocaleString().padEnd(16)}` +
          `${`${market.maxLeverage}x`.padEnd(12)}${`${market.venueMaxLeverage}x`.padEnd(12)}` +
          `${(market.fundingRate * 100).toFixed(4)}%`,
      );
    }
  });

program
  .command("quote")
  .description("Get an indicative read-only position quote; never opens a position")
  .option("--market <name>", "market symbol", "ETH-USD")
  .option("--side <side>", "long or short", "long")
  .option("--size <n>", "position size in base-asset units", Number, 1)
  .option("--leverage <n>", "leverage multiplier", Number, 5)
  .option("--json", "JSON output")
  .action(async (opts) => {
    const markets = await perpsApi.markets();
    const market = markets.find(
      (candidate) => candidate.name.toLowerCase() === String(opts.market).toLowerCase(),
    );
    if (!market) {
      throw new Error(`Unknown perps market "${opts.market}". Run "markets" to list supported markets.`);
    }
    const side = validatePerpsQuote({
      market: market.name,
      side: opts.side,
      size: opts.size,
      leverage: opts.leverage,
      maxLeverage: effectiveQuoteMaxLeverage(market.maxLeverage),
    });
    const quote = await perpsApi.quote({
      market: market.name,
      side,
      size: opts.size,
      leverage: opts.leverage,
    });
    if (opts.json) {
      console.log(JSON.stringify(quote, null, 2));
      return;
    }
    console.log(`\n${opts.size} ${market.name} ${side.toUpperCase()} @ ${opts.leverage}x\n`);
    console.log("  Indicative read-only quote — no position is opened.");
    console.log(`  Entry Price:       $${quote.entryPrice.toLocaleString()}`);
    console.log(`  Margin Required:   $${quote.margin.toFixed(2)}`);
    console.log(`  Liquidation Price: $${quote.liquidationPrice.toFixed(2)}`);
    console.log(`  Fee:               $${quote.fee.toFixed(2)}`);
    console.log(`  Funding Rate:      ${(quote.fundingRate * 100).toFixed(4)}%`);
  });

program
  .command("positions")
  .description("Read open positions for a Hyperliquid/EVM address")
  .option("--address <addr>", "Hyperliquid/EVM address; defaults to HL_ADDRESS")
  .option("--json", "JSON output")
  .action(async (opts) => {
    const address = resolveAddress(opts.address);
    const positions = await perpsApi.positions(address);
    if (opts.json) {
      console.log(JSON.stringify(positions, null, 2));
      return;
    }
    if (!positions.length) {
      console.log("No open positions returned.");
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
  .description("Build a read-only position-risk snapshot for dashboards and policies")
  .option("--address <addr>", "Hyperliquid/EVM address; defaults to HL_ADDRESS")
  .option(
    "--warn-within <pct>",
    "flag a reported liquidation buffer at or below this percentage",
    Number,
    10,
  )
  .option("--json", "JSON output")
  .action(async (opts) => {
    const address = resolveAddress(opts.address);
    const warnWithinPct = validateWarningThreshold(opts.warnWithin);
    const snapshot = await snapshotFor(address, warnWithinPct);
    if (opts.json) console.log(JSON.stringify(snapshot, null, 2));
    else printRiskSnapshot(snapshot);
  });

program
  .command("watch")
  .description("Evaluate a durable liquidation-distance rule and emit only meaningful transitions")
  .option("--address <addr>", "Hyperliquid/EVM address; defaults to HL_ADDRESS")
  .option(
    "--warn-within <pct>",
    "enter warning state at or below this reported liquidation-buffer percentage",
    Number,
    10,
  )
  .option(
    "--hysteresis <pct>",
    "percentage points above the warning threshold required to recover",
    Number,
    2,
  )
  .option("--json", "JSON output")
  .action(async (opts) => {
    const address = resolveAddress(opts.address);
    const warnWithinPct = validateWarningThreshold(opts.warnWithin);
    if (!Number.isFinite(opts.hysteresis) || opts.hysteresis <= 0) {
      throw new Error("--hysteresis must be a positive percentage");
    }
    const rule = validateWatchRule({
      address,
      warnWithinPct,
      recoverAbovePct: warnWithinPct + opts.hysteresis,
    });

    const lock = acquireStateLock();
    try {
      const state = loadWatchState();
      const snapshot = await snapshotFor(address, warnWithinPct);
      const evaluation = evaluateWatch(snapshot.positions, rule, state);
      saveWatchState(evaluation.nextState);
      const result = {
        computedAt: snapshot.computedAt,
        address,
        rule: {
          warnWithinPct: rule.warnWithinPct,
          recoverAbovePct: rule.recoverAbovePct,
        },
        positionCount: snapshot.positionCount,
        decisions: evaluation.decisions,
        notifications: evaluation.decisions.filter((decision) => decision.shouldNotify),
      };
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Evaluated ${result.positionCount} returned position(s).`);
      if (!result.notifications.length) {
        console.log("No alert transition to deliver.");
        return;
      }
      for (const event of result.notifications) {
        console.log(
          `${event.state.toUpperCase()}: ${event.market} ${event.side} — ${event.reason}`,
        );
      }
    } finally {
      lock.release();
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`Error: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
