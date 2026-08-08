import { afterEach, describe, expect, it } from "bun:test";
import { perpsApi } from "../src/api.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.SUWAPPU_API_KEY;
const originalRetries = process.env.SUWAPPU_READ_RETRIES;
const originalApiEvents = process.env.SUWAPPU_API_EVENTS;
const originalConsoleError = console.error;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.SUWAPPU_API_KEY;
  else process.env.SUWAPPU_API_KEY = originalKey;
  if (originalRetries === undefined) delete process.env.SUWAPPU_READ_RETRIES;
  else process.env.SUWAPPU_READ_RETRIES = originalRetries;
  if (originalApiEvents === undefined) delete process.env.SUWAPPU_API_EVENTS;
  else process.env.SUWAPPU_API_EVENTS = originalApiEvents;
  console.error = originalConsoleError;
});

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const market = {
  name: "ETH-USD",
  asset: "ETH",
  szDecimals: 4,
  maxLeverage: 20,
  venueMaxLeverage: 25,
  markPrice: 3200,
  fundingRate: 0.000125,
};

describe("Suwappu perps REST client", () => {
  it("retries a safe GET on retryable status and parses the live market contract", async () => {
    process.env.SUWAPPU_API_KEY = "suwappu_sk_should_not_be_sent_on_public_reads";
    process.env.SUWAPPU_READ_RETRIES = "2";
    let calls = 0;
    let authorization: string | null = "not-observed";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      authorization = new Headers(init?.headers).get("authorization");
      return calls === 1 ? json({ error: "temporary" }, 503) : json({ markets: [market] });
    }) as unknown as typeof fetch;

    const markets = await perpsApi.markets();
    expect(calls).toBe(2);
    expect(authorization).toBeNull();
    expect(markets[0]).toEqual(market);
  });

  it("authenticates position reads without putting the key in the URL", async () => {
    process.env.SUWAPPU_API_KEY = "suwappu_sk_test_key_that_is_long_enough";
    process.env.SUWAPPU_READ_RETRIES = "0";
    const seen: { url?: string; authorization?: string | null } = {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(input);
      seen.authorization = new Headers(init?.headers).get("authorization");
      return json({ positions: [] });
    }) as unknown as typeof fetch;

    await perpsApi.positions("0x1111111111111111111111111111111111111111");
    expect(seen.url).toContain("address=0x1111111111111111111111111111111111111111");
    expect(seen.url).not.toContain("suwappu_sk_");
    expect(seen.authorization).toBe("Bearer suwappu_sk_test_key_that_is_long_enough");
  });

  it("never automatically retries the non-idempotent quote contract", async () => {
    process.env.SUWAPPU_API_KEY = "suwappu_sk_test_key_that_is_long_enough";
    process.env.SUWAPPU_READ_RETRIES = "4";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return json({ error: "try later" }, 503);
    }) as unknown as typeof fetch;

    await expect(
      perpsApi.quote({ market: "ETH-USD", side: "long", size: 1, leverage: 5 }),
    ).rejects.toThrow("HTTP 503");
    expect(calls).toBe(1);
  });

  it("does not echo an upstream response body in errors", async () => {
    process.env.SUWAPPU_API_KEY = "suwappu_sk_test_key_that_is_long_enough";
    process.env.SUWAPPU_READ_RETRIES = "0";
    globalThis.fetch = (async () =>
      new Response("internal secret: do-not-log", { status: 500 })) as unknown as typeof fetch;

    let message = "";
    try {
      await perpsApi.positions("0x1111111111111111111111111111111111111111");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("HTTP 500");
    expect(message).not.toContain("do-not-log");
  });

  it("emits error telemetry, never ok, for invalid JSON and invalid schemas", async () => {
    process.env.SUWAPPU_READ_RETRIES = "0";
    process.env.SUWAPPU_API_EVENTS = "1";
    const events: string[] = [];
    console.error = (...args: unknown[]) => {
      events.push(args.map(String).join(" "));
    };

    globalThis.fetch = (async () =>
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    await expect(perpsApi.markets()).rejects.toThrow("invalid JSON");
    expect(events.map((event) => JSON.parse(event).outcome)).toEqual(["error"]);

    events.length = 0;
    globalThis.fetch = (async () => json({ markets: [{}] })) as unknown as typeof fetch;
    await expect(perpsApi.markets()).rejects.toThrow("invalid market response");
    expect(events.map((event) => JSON.parse(event).outcome)).toEqual(["error"]);
  });
});
