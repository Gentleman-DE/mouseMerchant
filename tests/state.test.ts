import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StateRepository } from "../src/state.js";
import type { AppConfig } from "../src/config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeConfig(): AppConfig {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "mousemerchant-"));
  tempDirs.push(stateDir);
  return {
    port: 3000,
    stateDir,
    stateFilePath: path.join(stateDir, "state.json"),
    webEnabled: true,
    trustProxy: false,
    httpsOnlyCookies: false,
    sessionTtlMs: 1000,
    requestTimeoutMs: 1000,
    allowedHosts: ["localhost"],
    allowedOrigins: [],
    masterKey: "test-master-key",
    initialAdminPassword: "strong-password-123",
    initialMamCookie: "cookie123",
    initialIntervalMs: 1000,
    initialReservePoints: 5000,
    initialAutoBuyEnabled: true,
    initialBuyAmountGb: 50,
    initialPollingEnabled: true,
  };
}

describe("state repository", () => {
  it("creates initial state with encrypted secrets", async () => {
    const repo = new StateRepository(makeConfig());
    const state = await repo.load();

    expect(repo.decryptMamCookie(state)).toBe("cookie123");
    expect(state.auth.adminPasswordHash).not.toContain("strong-password-123");
  });
});
