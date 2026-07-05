import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

import { decryptSecret, encryptSecret, hashPassword } from "./crypto.js";
import type { AppConfig } from "./config.js";

const stateSchema = z.object({
  settings: z.object({
    pollingEnabled: z.boolean(),
    intervalMs: z.number().int().positive(),
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
      return stateSchema.parse(JSON.parse(raw));
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
}
