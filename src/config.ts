import { mkdirSync, readFileSync } from "node:fs";
import { z } from "zod";

const boolSchema = z.enum(["true", "false"]).transform((value) => value === "true");
const positiveIntSchema = z.coerce.number().int().positive();
const isoDatetimeSchema = z.string().datetime();
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function fromEnvOrFile(name: string): string | undefined {
  const filePath = getEnv(`${name}_FILE`);
  if (filePath) {
    return readFileSync(filePath, "utf8").trim() || undefined;
  }
  return getEnv(name);
}

function parseBoolean(name: string, defaultValue: boolean): boolean {
  const raw = getEnv(name);
  if (!raw) return defaultValue;
  return boolSchema.parse(raw);
}

function parsePositiveInt(name: string, defaultValue: number): number {
  const raw = getEnv(name);
  if (!raw) return defaultValue;
  return positiveIntSchema.parse(raw);
}

function parseIsoDatetime(name: string): string | undefined {
  const raw = getEnv(name);
  if (!raw) return undefined;
  return isoDatetimeSchema.parse(raw);
}

function parseTime(name: string): string | undefined {
  const raw = getEnv(name);
  if (!raw) return undefined;
  return timeSchema.parse(raw);
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  if (value === "*") return ["*"];
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Allowlist environment variables must not be empty.");
  }
  return parts;
}

export type AppConfig = ReturnType<typeof buildConfig>;

export function buildConfig() {
  const stateDir = getEnv("MOUSEMERCHANT_STATE_DIR") ?? `${process.cwd()}/data`;
  mkdirSync(stateDir, { recursive: true });
  const masterKey = fromEnvOrFile("MOUSEMERCHANT_MASTER_KEY");
  if (!masterKey) {
    throw new Error("MOUSEMERCHANT_MASTER_KEY is required.");
  }

  const config = {
    port: parsePositiveInt("MOUSEMERCHANT_PORT", 3000),
    stateDir,
    stateFilePath: `${stateDir}/state.json`,
    webEnabled: parseBoolean("MOUSEMERCHANT_WEB_ENABLED", true),
    trustProxy: parseBoolean("MOUSEMERCHANT_TRUST_PROXY", false),
    httpsOnlyCookies: parseBoolean("MOUSEMERCHANT_HTTPS_ONLY_COOKIES", false),
    sessionTtlMs: parsePositiveInt("MOUSEMERCHANT_SESSION_TTL_MS", 1000 * 60 * 60 * 24 * 7),
    requestTimeoutMs: parsePositiveInt("MOUSEMERCHANT_REQUEST_TIMEOUT_MS", 15000),
    allowedHosts: parseList(getEnv("MOUSEMERCHANT_ALLOWED_HOSTS"), ["localhost", "127.0.0.1", "[::1]"]),
    allowedOrigins: parseList(getEnv("MOUSEMERCHANT_ALLOWED_ORIGINS"), []),
    masterKey,
    initialAdminPassword: fromEnvOrFile("MOUSEMERCHANT_ADMIN_PASSWORD"),
    initialMamCookie: fromEnvOrFile("MOUSEMERCHANT_INITIAL_MAM_COOKIE"),
    initialIntervalMs: parsePositiveInt("MOUSEMERCHANT_INITIAL_INTERVAL_MS", 1000 * 60 * 60 * 24),
    initialScheduleStartAt: parseIsoDatetime("MOUSEMERCHANT_INITIAL_SCHEDULE_START_AT"),
    initialScheduleTime: parseTime("MOUSEMERCHANT_INITIAL_SCHEDULE_TIME"),
    initialReservePoints: parsePositiveInt("MOUSEMERCHANT_INITIAL_RESERVE_POINTS", 5000),
    initialAutoBuyEnabled: parseBoolean("MOUSEMERCHANT_INITIAL_AUTO_BUY_ENABLED", true),
    initialBuyAmountGb: Math.max(parsePositiveInt("MOUSEMERCHANT_INITIAL_BUY_AMOUNT_GB", 50), 50),
    initialPollingEnabled: parseBoolean("MOUSEMERCHANT_INITIAL_POLLING_ENABLED", true),
  };

  if (config.webEnabled && !config.initialAdminPassword && !readFileSyncSafe(config.stateFilePath)) {
    throw new Error("MOUSEMERCHANT_ADMIN_PASSWORD is required on first startup when the web UI is enabled.");
  }

  return config;
}

function readFileSyncSafe(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}
