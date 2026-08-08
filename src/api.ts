import { loadRuntimeConfig, requireApiKey, type RuntimeConfig } from "./config.js";

type RecordLike = Record<string, unknown>;

export interface PerpsMarket {
  name: string;
  asset: string;
  szDecimals: number;
  maxLeverage: number;
  venueMaxLeverage: number;
  markPrice: number;
  fundingRate: number;
}

export interface PerpsPosition {
  id: string;
  market: string;
  side: "long" | "short";
  size: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  margin: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  fundingRate: number;
}

export interface PerpsQuote {
  market: string;
  side: "long" | "short";
  size: number;
  leverage: number;
  entryPrice: number;
  margin: number;
  liquidationPrice: number;
  fundingRate: number;
  fee: number;
}

export class SuwappuPerpsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SuwappuPerpsError";
  }
}

function record(value: unknown, label: string): RecordLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SuwappuPerpsError(`Suwappu API returned an invalid ${label} response`, null);
  }
  return value as RecordLike;
}

function stringField(root: RecordLike, field: string, label: string): string {
  const value = root[field];
  if (typeof value !== "string" || !value) {
    throw new SuwappuPerpsError(`Suwappu API returned an invalid ${label} response`, null);
  }
  return value;
}

function numberField(root: RecordLike, field: string, label: string): number {
  const value = root[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SuwappuPerpsError(`Suwappu API returned an invalid ${label} response`, null);
  }
  return value;
}

function sideField(root: RecordLike, label: string): "long" | "short" {
  const side = root.side;
  if (side !== "long" && side !== "short") {
    throw new SuwappuPerpsError(`Suwappu API returned an invalid ${label} response`, null);
  }
  return side;
}

function arrayField(root: RecordLike, field: string, label: string): unknown[] {
  const value = root[field];
  if (!Array.isArray(value)) {
    throw new SuwappuPerpsError(`Suwappu API returned an invalid ${label} response`, null);
  }
  return value;
}

function parseMarket(value: unknown): PerpsMarket {
  const row = record(value, "market");
  return {
    name: stringField(row, "name", "market"),
    asset: stringField(row, "asset", "market"),
    szDecimals: numberField(row, "szDecimals", "market"),
    maxLeverage: numberField(row, "maxLeverage", "market"),
    venueMaxLeverage: numberField(row, "venueMaxLeverage", "market"),
    markPrice: numberField(row, "markPrice", "market"),
    fundingRate: numberField(row, "fundingRate", "market"),
  };
}

function parsePosition(value: unknown): PerpsPosition {
  const row = record(value, "position");
  return {
    id: stringField(row, "id", "position"),
    market: stringField(row, "market", "position"),
    side: sideField(row, "position"),
    size: numberField(row, "size", "position"),
    leverage: numberField(row, "leverage", "position"),
    entryPrice: numberField(row, "entryPrice", "position"),
    markPrice: numberField(row, "markPrice", "position"),
    margin: numberField(row, "margin", "position"),
    unrealizedPnl: numberField(row, "unrealizedPnl", "position"),
    liquidationPrice: numberField(row, "liquidationPrice", "position"),
    fundingRate: numberField(row, "fundingRate", "position"),
  };
}

function parseQuote(value: unknown): PerpsQuote {
  const row = record(value, "quote");
  return {
    market: stringField(row, "market", "quote"),
    side: sideField(row, "quote"),
    size: numberField(row, "size", "quote"),
    leverage: numberField(row, "leverage", "quote"),
    entryPrice: numberField(row, "entryPrice", "quote"),
    margin: numberField(row, "margin", "quote"),
    liquidationPrice: numberField(row, "liquidationPrice", "quote"),
    fundingRate: numberField(row, "fundingRate", "quote"),
    fee: numberField(row, "fee", "quote"),
  };
}

function emitApiEvent(
  config: RuntimeConfig,
  operation: string,
  outcome: "ok" | "retry" | "error",
  attempt: number,
  startedAt: number,
  status: number | null,
): void {
  if (!config.apiEvents) return;
  console.error(
    JSON.stringify({
      event: "suwappu.api",
      operation,
      outcome,
      attempt,
      durationMs: Date.now() - startedAt,
      status,
    }),
  );
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5_000);
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), 5_000);
  }
  return Math.min(250 * 2 ** (attempt - 1), 2_000);
}

async function pause(ms: number): Promise<void> {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseJson(response: Response, operation: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SuwappuPerpsError(`Suwappu API returned invalid JSON for ${operation}`, response.status);
  }
}

async function getJson(
  operation: string,
  path: string,
  params: Record<string, string | undefined> = {},
  authenticated = false,
): Promise<unknown> {
  const config = loadRuntimeConfig();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  // Never attach a credential to a public read. Besides least privilege, this
  // prevents a configured key from needlessly appearing on market discovery.
  const key = authenticated ? requireApiKey(config) : null;
  const url = `${config.apiBaseUrl}${path}${search.size ? `?${search.toString()}` : ""}`;

  for (let attempt = 1; attempt <= config.readRetries + 1; attempt += 1) {
    const startedAt = Date.now();
    let response: Response | null = null;
    try {
      response = await fetch(url, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch {
      const retry = attempt <= config.readRetries;
      emitApiEvent(config, operation, retry ? "retry" : "error", attempt, startedAt, null);
      if (retry) {
        await pause(retryDelay(null, attempt));
        continue;
      }
      throw new SuwappuPerpsError(
        `Suwappu API ${operation} request failed after ${attempt} attempt${attempt === 1 ? "" : "s"}`,
        null,
      );
    }

    if (!response.ok) {
      const retry = retryableStatus(response.status) && attempt <= config.readRetries;
      emitApiEvent(config, operation, retry ? "retry" : "error", attempt, startedAt, response.status);
      if (retry) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      throw new SuwappuPerpsError(
        `Suwappu API ${operation} failed with HTTP ${response.status}`,
        response.status,
      );
    }

    const payload = await responseJson(response, operation);
    emitApiEvent(config, operation, "ok", attempt, startedAt, response.status);
    return payload;
  }
  throw new SuwappuPerpsError(`Suwappu API ${operation} request failed`, null);
}

async function postJson(operation: string, path: string, body: unknown): Promise<unknown> {
  const config = loadRuntimeConfig();
  const key = requireApiKey(config);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch {
    emitApiEvent(config, operation, "error", 1, startedAt, null);
    throw new SuwappuPerpsError(`Suwappu API ${operation} request failed`, null);
  }
  if (!response.ok) {
    emitApiEvent(config, operation, "error", 1, startedAt, response.status);
    throw new SuwappuPerpsError(
      `Suwappu API ${operation} failed with HTTP ${response.status}`,
      response.status,
    );
  }
  const payload = await responseJson(response, operation);
  emitApiEvent(config, operation, "ok", 1, startedAt, response.status);
  return payload;
}

/**
 * Least-authority Suwappu perps client. GET reads use bounded retries; quote is
 * intentionally one-shot because the hosted MCP contract marks it non-idempotent.
 */
export const perpsApi = {
  markets: async (): Promise<PerpsMarket[]> => {
    const root = record(await getJson("perps.markets", "/v1/agent/perps/markets"), "markets");
    return arrayField(root, "markets", "markets").map(parseMarket);
  },
  positions: async (address: string): Promise<PerpsPosition[]> => {
    const root = record(
      await getJson("perps.positions", "/v1/agent/perps/positions", { address }, true),
      "positions",
    );
    return arrayField(root, "positions", "positions").map(parsePosition);
  },
  quote: async (args: {
    market: string;
    side: "long" | "short";
    size: number;
    leverage: number;
  }): Promise<PerpsQuote> =>
    parseQuote(await postJson("perps.quote", "/v1/agent/perps/quote", args)),
};
