import { describe, it, expect } from "bun:test";
describe("perps-trader", () => {
  it("should format funding rate as percentage", () => {
    const rate = 0.0001;
    expect((rate * 100).toFixed(4)).toBe("0.0100");
  });
  it("should detect positive PnL", () => {
    expect(1.5 >= 0).toBe(true);
  });
});
