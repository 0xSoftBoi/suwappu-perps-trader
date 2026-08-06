export function positiveInteger(value: number, flag: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

export function validatePerpsQuote(options: {
  market: string;
  side: string;
  size: number;
  leverage: number;
  maxLeverage: number;
}): "long" | "short" {
  const side = options.side.toLowerCase();
  if (side !== "long" && side !== "short") {
    throw new Error("--side must be long or short");
  }
  if (!Number.isFinite(options.size) || options.size <= 0) {
    throw new Error("--size must be positive");
  }
  if (!Number.isFinite(options.leverage) || options.leverage < 1) {
    throw new Error("--leverage must be at least 1");
  }
  if (!Number.isFinite(options.maxLeverage) || options.maxLeverage <= 0) {
    throw new Error(`No valid leverage limit returned for ${options.market}`);
  }
  if (options.leverage > options.maxLeverage) {
    throw new Error(
      `${options.market} supports at most ${options.maxLeverage}x leverage; requested ${options.leverage}x`,
    );
  }
  return side;
}

export function validateAddress(address: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("HyperLiquid address must be a 0x-prefixed 20-byte address");
  }
  return address;
}
