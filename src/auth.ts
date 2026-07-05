import { randomUUID, timingSafeEqual } from "node:crypto";

import { hashPassword, verifyPassword } from "./crypto.js";
import type { AppConfig } from "./config.js";
import type { AppState, StateRepository } from "./state.js";

type SessionRecord = {
  expiresAt: number;
};

export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly config: AppConfig,
    private readonly stateRepo: StateRepository,
  ) {}

  login(password: string, state: AppState): string | null {
    if (!verifyPassword(password, state.auth.adminPasswordHash)) {
      return null;
    }

    const sessionId = randomUUID();
    this.sessions.set(sessionId, { expiresAt: Date.now() + this.config.sessionTtlMs });
    return sessionId;
  }

  isSessionValid(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    if (record.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  invalidateSession(sessionId: string | undefined): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  invalidateAllSessions(): void {
    this.sessions.clear();
  }

  setPassword(state: AppState, password: string): AppState {
    return {
      ...state,
      auth: {
        adminPasswordHash: hashPassword(password),
      },
    };
  }

}
