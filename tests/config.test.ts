import { describe, expect, it } from "bun:test";
import { loadRuntimeConfig, requireApiKey } from "../src/config.js";

const key = "suwappu_sk_test_key_that_is_long_enough";

describe("runtime configuration", () => {
  it("accepts the production Suwappu origin", () => {
    const config = loadRuntimeConfig({ SUWAPPU_API_KEY: key });
    expect(requireApiKey(config)).toBe(key);
  });

  it("refuses to send an API key to an unapproved custom origin", () => {
    const config = loadRuntimeConfig({
      SUWAPPU_API_KEY: key,
      SUWAPPU_API_URL: "https://staging.example.com",
    });
    expect(() => requireApiKey(config)).toThrow("Refusing to send");
  });

  it("allows an explicitly approved custom authenticated origin", () => {
    const config = loadRuntimeConfig({
      SUWAPPU_API_KEY: key,
      SUWAPPU_API_URL: "https://staging.example.com",
      SUWAPPU_ALLOW_CUSTOM_AUTH_ORIGIN: "1",
    });
    expect(requireApiKey(config)).toBe(key);
  });

  it("rejects credential-bearing and insecure remote API URLs", () => {
    expect(() => loadRuntimeConfig({ SUWAPPU_API_URL: "http://example.com" })).toThrow("HTTPS");
    expect(() => loadRuntimeConfig({ SUWAPPU_API_URL: "https://user@example.com" })).toThrow(
      "credentials",
    );
  });
});
