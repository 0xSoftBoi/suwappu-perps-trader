import { describe, expect, it } from "bun:test";
import {
  positiveInteger,
  validateAddress,
  validatePerpsQuote,
} from "../src/validation.js";

describe("perps quote validation", () => {
  it("accepts a valid quote within the market leverage cap", () => {
    expect(
      validatePerpsQuote({
        market: "ETH-USD",
        side: "long",
        size: 1,
        leverage: 5,
        maxLeverage: 20,
      }),
    ).toBe("long");
  });

  it("rejects leverage above the actual market cap", () => {
    expect(() =>
      validatePerpsQuote({
        market: "ETH-USD",
        side: "short",
        size: 1,
        leverage: 21,
        maxLeverage: 20,
      }),
    ).toThrow("at most 20x");
  });

  it("rejects non-positive size and leverage", () => {
    expect(() =>
      validatePerpsQuote({
        market: "ETH-USD",
        side: "long",
        size: 0,
        leverage: 5,
        maxLeverage: 20,
      }),
    ).toThrow("--size must be positive");

    expect(() =>
      validatePerpsQuote({
        market: "ETH-USD",
        side: "long",
        size: 1,
        leverage: 0,
        maxLeverage: 20,
      }),
    ).toThrow("--leverage must be at least 1");
  });

  it("accepts only long/short sides", () => {
    expect(() =>
      validatePerpsQuote({
        market: "ETH-USD",
        side: "buy",
        size: 1,
        leverage: 5,
        maxLeverage: 20,
      }),
    ).toThrow("--side must be long or short");
  });
});

describe("CLI input validation", () => {
  it("requires a positive integer market limit", () => {
    expect(positiveInteger(10, "--top")).toBe(10);
    expect(() => positiveInteger(0, "--top")).toThrow("--top");
    expect(() => positiveInteger(1.5, "--top")).toThrow("--top");
  });

  it("validates HyperLiquid/EVM addresses", () => {
    expect(validateAddress("0x1111111111111111111111111111111111111111")).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(() => validateAddress("0x123")).toThrow("20-byte");
  });
});
