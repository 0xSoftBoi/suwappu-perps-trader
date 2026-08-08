import { describe, expect, it } from "bun:test";
import type { PositionRisk } from "../src/risk.js";
import type { WatchState } from "../src/state.js";
import { evaluatePosition, evaluateWatch, validateWatchRule, watchKey } from "../src/watch.js";

const address = "0x1111111111111111111111111111111111111111";
const rule = { address, warnWithinPct: 10, recoverAbovePct: 12 };

function position(distance: number | null, overrides: Partial<PositionRisk> = {}): PositionRisk {
  return {
    id: "unstable-upstream-id",
    market: "ETH-USD",
    side: "long",
    size: 1,
    leverage: 5,
    markPrice: 100,
    liquidationPrice: distance === null ? null : 100 - distance,
    notionalUsd: 100,
    marginUsd: 20,
    unrealizedPnlUsd: 0,
    fundingRate: 0.0001,
    pnlOnMarginPct: 0,
    liquidationDistancePct: distance,
    leverageUtilizationPct: 25,
    warnings: [],
    ...overrides,
  };
}

describe("durable perps watch", () => {
  it("alerts on entry, suppresses repeats, and recovers only across hysteresis", () => {
    const first = evaluatePosition(position(9), rule, undefined, new Date("2026-08-07T12:00:00Z"));
    expect(first.decision.state).toBe("warning");
    expect(first.decision.shouldNotify).toBe(true);

    const still = evaluatePosition(position(11), rule, first.nextEntry!, new Date("2026-08-07T12:01:00Z"));
    expect(still.decision.state).toBe("unchanged");
    expect(still.decision.shouldNotify).toBe(false);

    const recovered = evaluatePosition(position(12), rule, still.nextEntry!, new Date("2026-08-07T12:02:00Z"));
    expect(recovered.decision.state).toBe("recovered");
    expect(recovered.decision.shouldNotify).toBe(true);
  });

  it("preserves prior state when liquidation evidence is unavailable", () => {
    const active = evaluatePosition(position(8), rule, undefined).nextEntry!;
    const unknown = evaluatePosition(position(null), rule, active);
    expect(unknown.decision.state).toBe("insufficient_data");
    expect(unknown.nextEntry).toBeNull();
  });

  it("does not treat a missing previously alerted position as recovered", () => {
    const key = watchKey(rule, "ETH-USD", "long");
    const active = evaluatePosition(position(8), rule, undefined, new Date("2026-08-07T12:00:00Z")).nextEntry!;
    const state: WatchState = { version: 1, watches: { [key]: active } };

    const missing = evaluateWatch([], rule, state, new Date("2026-08-07T12:01:00Z"));
    expect(missing.decisions[0]?.state).toBe("not_returned");
    expect(missing.decisions[0]?.shouldNotify).toBe(true);
    expect(missing.nextState.watches[key]?.active).toBe(true);

    const repeated = evaluateWatch([], rule, missing.nextState, new Date("2026-08-07T12:02:00Z"));
    expect(repeated.decisions[0]?.state).toBe("not_returned");
    expect(repeated.decisions[0]?.shouldNotify).toBe(false);
  });

  it("re-arms a missing alert after the position is observed with unavailable risk evidence", () => {
    const key = watchKey(rule, "ETH-USD", "long");
    const active = evaluatePosition(
      position(8),
      rule,
      undefined,
      new Date("2026-08-07T12:00:00Z"),
    ).nextEntry!;
    const firstMissing = evaluateWatch(
      [],
      rule,
      { version: 1, watches: { [key]: active } },
      new Date("2026-08-07T12:01:00Z"),
    );

    const observedUnknown = evaluateWatch(
      [position(null)],
      rule,
      firstMissing.nextState,
      new Date("2026-08-07T12:02:00Z"),
    );
    expect(observedUnknown.decisions[0]?.state).toBe("insufficient_data");
    expect(observedUnknown.nextState.watches[key]?.active).toBe(true);
    expect(observedUnknown.nextState.watches[key]?.missing).toBe(false);
    expect(observedUnknown.nextState.watches[key]?.missingSince).toBeNull();

    const missingAgain = evaluateWatch(
      [],
      rule,
      observedUnknown.nextState,
      new Date("2026-08-07T12:03:00Z"),
    );
    expect(missingAgain.decisions[0]?.state).toBe("not_returned");
    expect(missingAgain.decisions[0]?.shouldNotify).toBe(true);
  });

  it("normalizes decimal recovery boundaries to risk-distance precision", () => {
    const decimalRule = {
      address,
      warnWithinPct: 0.1,
      recoverAbovePct: 0.1 + 0.2,
    };
    expect(validateWatchRule(decimalRule).recoverAbovePct).toBe(0.3);
    const active = evaluatePosition(position(0.05), decimalRule, undefined).nextEntry!;
    const recovered = evaluatePosition(position(0.3), decimalRule, active);
    expect(recovered.decision.state).toBe("recovered");
    expect(recovered.decision.shouldNotify).toBe(true);
  });

  it("keys rules by wallet/market/side and thresholds, not the unstable upstream id", () => {
    expect(watchKey(rule, "ETH-USD", "long")).toBe(watchKey(rule, "ETH-USD", "long"));
    expect(watchKey(rule, "ETH-USD", "long")).not.toBe(watchKey(rule, "ETH-USD", "short"));
  });

  it("rejects a recovery boundary that does not exceed the warning boundary", () => {
    expect(() =>
      validateWatchRule({ address, warnWithinPct: 10, recoverAbovePct: 10 }),
    ).toThrow("greater");
  });
});
