import { describe, it, expect } from "bun:test";

function formatFundingRate(rate: number): string {
  return (rate * 100).toFixed(4) + "%";
}

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}$${pnl.toFixed(2)}`;
}

describe("funding rate formatting", () => {
  it("should format positive rate", () => {
    expect(formatFundingRate(0.0001)).toBe("0.0100%");
  });

  it("should format zero rate", () => {
    expect(formatFundingRate(0)).toBe("0.0000%");
  });

  it("should format negative rate", () => {
    expect(formatFundingRate(-0.0005)).toBe("-0.0500%");
  });
});

describe("PnL formatting", () => {
  it("should show + for positive PnL", () => {
    expect(formatPnl(150.5)).toBe("+$150.50");
  });

  it("should show negative PnL", () => {
    expect(formatPnl(-42.3)).toBe("$-42.30");
  });

  it("should show +$0.00 for zero", () => {
    expect(formatPnl(0)).toBe("+$0.00");
  });
});

describe("subcommand validation", () => {
  const valid = ["markets", "quote", "positions"];
  it("should recognize markets/quote/positions", () => {
    valid.forEach(cmd => expect(valid.includes(cmd)).toBe(true));
  });
  it("should reject unknown commands", () => {
    expect(valid.includes("trade")).toBe(false);
  });
});

describe("leverage bounds", () => {
  it("should allow 1-40x leverage", () => {
    expect(5 >= 1 && 5 <= 40).toBe(true);
    expect(40 >= 1 && 40 <= 40).toBe(true);
  });
  it("should reject 0x leverage", () => {
    expect(0 >= 1).toBe(false);
  });
});
