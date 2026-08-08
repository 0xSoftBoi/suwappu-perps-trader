import { describe, expect, it } from "bun:test";
import { buildRiskSnapshot, validateWarningThreshold } from "../src/risk.js";

const address = "0x1111111111111111111111111111111111111111";

describe("perps risk snapshot", () => {
  it("derives notional, PnL-on-margin, liquidation buffer, and leverage utilization", () => {
    const snapshot = buildRiskSnapshot({
      address,
      computedAt: "2026-08-07T12:00:00.000Z",
      warnWithinPct: 12,
      markets: [{ name: "ETH-USD", maxLeverage: 20 }],
      positions: [
        {
          id: "ETH-0",
          market: "ETH-USD",
          side: "long",
          size: 2,
          leverage: 5,
          entryPrice: 95,
          markPrice: 100,
          margin: 40,
          unrealizedPnl: 5,
          liquidationPrice: 90,
          fundingRate: 0.000125,
        },
      ],
    });

    expect(snapshot.totals).toEqual({
      notionalUsd: 200,
      marginUsd: 40,
      unrealizedPnlUsd: 5,
    });
    expect(snapshot.nearestLiquidationDistancePct).toBe(10);
    expect(snapshot.positions[0]?.pnlOnMarginPct).toBe(12.5);
    expect(snapshot.positions[0]?.fundingRate).toBe(0.000125);
    expect(snapshot.positions[0]?.leverageUtilizationPct).toBe(25);
    expect(snapshot.positions[0]?.warnings[0]).toContain("within 12% threshold");
  });

  it("uses the correct directional buffer for a short and preserves unavailable liquidation", () => {
    const snapshot = buildRiskSnapshot({
      address,
      warnWithinPct: 10,
      markets: [
        { name: "BTC-USD", maxLeverage: 40 },
        { name: "SOL-USD", maxLeverage: 20 },
      ],
      positions: [
        {
          id: "BTC-0",
          market: "BTC-USD",
          side: "short",
          size: 1,
          leverage: 4,
          entryPrice: 100,
          markPrice: 100,
          margin: 25,
          unrealizedPnl: -2,
          liquidationPrice: 115,
        },
        {
          id: "SOL-1",
          market: "SOL-USD",
          side: "long",
          size: 3,
          leverage: 2,
          entryPrice: 20,
          markPrice: 20,
          margin: 30,
          unrealizedPnl: 0,
          liquidationPrice: 0,
        },
      ],
    });

    expect(snapshot.positions[0]?.liquidationDistancePct).toBe(15);
    expect(snapshot.positions[1]?.liquidationDistancePct).toBeNull();
    expect(snapshot.positions[1]?.warnings).toContain("liquidation price unavailable");
  });

  it("flags missing market metadata without inventing a leverage ceiling", () => {
    const snapshot = buildRiskSnapshot({
      address,
      warnWithinPct: 5,
      markets: [],
      positions: [
        {
          id: "NEW-0",
          market: "NEW-USD",
          side: "long",
          size: 1,
          leverage: 2,
          entryPrice: 10,
          markPrice: 10,
          margin: 5,
          unrealizedPnl: 0,
          liquidationPrice: 8,
        },
      ],
    });

    expect(snapshot.positions[0]?.leverageUtilizationPct).toBeNull();
    expect(snapshot.positions[0]?.warnings).toContain("market leverage metadata unavailable");
  });

  it("rejects invalid warning thresholds", () => {
    expect(() => validateWarningThreshold(0)).toThrow("positive percentage");
    expect(() => validateWarningThreshold(Number.NaN)).toThrow("positive percentage");
  });
});
