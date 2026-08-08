export interface RuntimeConfig {
  apiBaseUrl: string;
  apiKey: string | null;
  requestTimeoutMs: number;
  readRetries: number;
  apiEvents: boolean;
  allowCustomAuthOrigin: boolean;
}

function boundedInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function baseUrl(raw: string | undefined): string {
  const value = raw ?? "https://api.suwappu.bot";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SUWAPPU_API_URL must be an absolute URL");
  }

  const localHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("SUWAPPU_API_URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("SUWAPPU_API_URL must not contain credentials, query parameters, or a fragment");
  }
  return url.toString().replace(/\/$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function apiKey(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  if (raw !== raw.trim()) {
    throw new Error("SUWAPPU_API_KEY must not contain leading or trailing whitespace");
  }
  return raw;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    apiBaseUrl: baseUrl(env.SUWAPPU_API_URL),
    apiKey: apiKey(env.SUWAPPU_API_KEY),
    requestTimeoutMs: boundedInteger(
      "SUWAPPU_REQUEST_TIMEOUT_MS",
      env.SUWAPPU_REQUEST_TIMEOUT_MS,
      20_000,
      250,
      30_000,
    ),
    readRetries: boundedInteger("SUWAPPU_READ_RETRIES", env.SUWAPPU_READ_RETRIES, 2, 0, 4),
    apiEvents: env.SUWAPPU_API_EVENTS === "1" || env.SUWAPPU_API_EVENTS === "true",
    allowCustomAuthOrigin:
      env.SUWAPPU_ALLOW_CUSTOM_AUTH_ORIGIN === "1" ||
      env.SUWAPPU_ALLOW_CUSTOM_AUTH_ORIGIN === "true",
  };
}

export function requireApiKey(config: RuntimeConfig): string {
  if (!config.apiKey) {
    throw new Error("SUWAPPU_API_KEY is required for authenticated perps requests");
  }
  const url = new URL(config.apiBaseUrl);
  const trustedOrigin =
    url.origin === "https://api.suwappu.bot" || isLoopbackHostname(url.hostname);
  if (!trustedOrigin && !config.allowCustomAuthOrigin) {
    throw new Error(
      "Refusing to send SUWAPPU_API_KEY to a custom origin; set SUWAPPU_ALLOW_CUSTOM_AUTH_ORIGIN=1 only after verifying that endpoint",
    );
  }
  return config.apiKey;
}
