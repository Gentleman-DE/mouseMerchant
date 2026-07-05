import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

import { decryptSecret, encryptSecret, hashPassword } from "./crypto.js";
import type { AppConfig } from "./config.js";

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const stateSchema = z.object({
  settings: z.object({
    pollingEnabled: z.boolean(),
    intervalMs: z.number().int().positive(),
    scheduleTime: timeSchema,
    reservePoints: z.number().int().nonnegative(),
    autoBuyEnabled: z.boolean(),
    buyAmountGb: z.number().int().min(50),
  }),
  secrets: z.object({
    mamCookieEncrypted: z.string().nullable(),
  }),
  auth: z.object({
    adminPasswordHash: z.string(),
  }),
  runtime: z.object({
    lastPoints: z.number().int().nonnegative().nullable(),
    lastRunAt: z.string().nullable(),
    lastBuyAt: z.string().nullable(),
    nextRunAt: z.string().nullable(),
    lastError: z.string().nullable(),
    updatedAt: z.string(),
    history: z.array(
      z.object({
        at: z.string(),
        points: z.number().int().nonnegative(),
        action: z.enum(["check", "buy"]),
        note: z.string(),
      }),
    ),
  }),
});

export type AppState = z.infer<typeof stateSchema>;

export type PublicState = {
  settings: AppState["settings"];
  runtime: AppState["runtime"];
  hasMamCookie: boolean;
};

export class StateRepository {
  constructor(private readonly config: AppConfig) {}

  async load(): Promise<AppState> {
    try {
      const raw = await readFile(this.config.stateFilePath, "utf8");
      return this.normalizeState(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return this.createInitialState();
    }
  }

  async save(state: AppState): Promise<void> {
    await mkdir(this.config.stateDir, { recursive: true });
    const tmpPath = `${this.config.stateFilePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(tmpPath, this.config.stateFilePath);
  }

  createInitialState(): AppState {
    const now = new Date().toISOString();
    return {
      settings: {
        pollingEnabled: this.config.initialPollingEnabled,
        intervalMs: this.config.initialIntervalMs,
        scheduleTime: resolveInitialScheduleTime(this.config.initialScheduleTime, this.config.initialScheduleStartAt, now),
        reservePoints: this.config.initialReservePoints,
        autoBuyEnabled: this.config.initialAutoBuyEnabled,
        buyAmountGb: this.config.initialBuyAmountGb,
      },
      secrets: {
        mamCookieEncrypted: this.config.initialMamCookie
          ? encryptSecret(this.config.initialMamCookie, this.config.masterKey)
          : null,
      },
      auth: {
        adminPasswordHash: hashPassword(this.config.initialAdminPassword ?? "change-me-now"),
      },
      runtime: {
        lastPoints: null,
        lastRunAt: null,
        lastBuyAt: null,
        nextRunAt: this.config.initialPollingEnabled ? (this.config.initialScheduleStartAt ?? now) : null,
        lastError: null,
        updatedAt: now,
      history: [],
      },
    };
  }

  decryptMamCookie(state: AppState): string | null {
    return state.secrets.mamCookieEncrypted
      ? decryptSecret(state.secrets.mamCookieEncrypted, this.config.masterKey)
      : null;
  }

  encryptMamCookie(value: string | null): string | null {
    return value ? encryptSecret(value, this.config.masterKey) : null;
  }

  toPublicState(state: AppState): PublicState {
    return {
      settings: state.settings,
      runtime: state.runtime,
      hasMamCookie: state.secrets.mamCookieEncrypted !== null,
    };
  }

  private normalizeState(raw: unknown): AppState {
    const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const settings = record.settings && typeof record.settings === "object"
      ? record.settings as Record<string, unknown>
      : {};
    const runtime = record.runtime && typeof record.runtime === "object"
      ? runtimeRecord(record.runtime)
      : {};
    const fallbackIso = typeof runtime.updatedAt === "string" && !Number.isNaN(Date.parse(runtime.updatedAt))
      ? runtime.updatedAt
      : new Date().toISOString();

    return stateSchema.parse({
      ...record,
      settings: {
        ...settings,
        scheduleTime: deriveScheduleTime(settings, fallbackIso),
      },
      runtime: {
        ...runtime,
        nextRunAt:
          typeof runtime.nextRunAt === "string" || runtime.nextRunAt === null
            ? runtime.nextRunAt
            : null,
      },
    });
  }
}

function runtimeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function resolveInitialScheduleTime(
  configuredTime: string | undefined,
  configuredIso: string | undefined,
  fallbackIso: string,
): string {
  if (configuredTime) {
    return configuredTime;
  }
  return formatTimeFromIso(configuredIso ?? fallbackIso);
}

function deriveScheduleTime(settings: Record<string, unknown>, fallbackIso: string): string {
  if (typeof settings.scheduleTime === "string" && timeSchema.safeParse(settings.scheduleTime).success) {
    return settings.scheduleTime;
  }
  if (typeof settings.scheduleStartAt === "string" && !Number.isNaN(Date.parse(settings.scheduleStartAt))) {
    return formatTimeFromIso(settings.scheduleStartAt);
  }
  return formatTimeFromIso(fallbackIso);
}

function formatTimeFromIso(value: string): string {
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
