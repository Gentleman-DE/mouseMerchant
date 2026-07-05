import type { MamClient } from "./mam.js";
import type { AppState, StateRepository } from "./state.js";

type UpdateState = (updater: (state: AppState) => Promise<AppState> | AppState) => Promise<AppState>;

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly stateRepo: StateRepository,
    private readonly mamClient: MamClient,
    private readonly updateState: UpdateState,
  ) {}

  async start(): Promise<void> {
    const state = await this.updateState((current) => current);
    if (!state.settings.pollingEnabled) {
      await this.syncScheduleMetadata();
      this.stop();
      return;
    }

    if (this.shouldRunImmediately(state)) {
      await this.runNow();
    } else {
      const scheduledState = await this.syncScheduleMetadata();
      this.applyTimer(scheduledState);
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runNow(): Promise<AppState> {
    if (this.running) {
      throw new Error("A points check is already running.");
    }

    this.running = true;
    try {
      const nextState = await this.updateState(async (state) => {
        const mamCookie = this.stateRepo.decryptMamCookie(state);
        if (!mamCookie) {
          return this.withError(state, "MAM cookie is not configured.");
        }

        try {
          const pointsResult = await this.mamClient.fetchPoints(mamCookie);
          let updatedState = this.withHistory({
            ...state,
            runtime: {
              ...state.runtime,
              lastPoints: pointsResult.points,
              lastRunAt: new Date().toISOString(),
              nextRunAt: null,
              lastError: null,
              updatedAt: new Date().toISOString(),
            },
            secrets: {
              ...state.secrets,
              mamCookieEncrypted: pointsResult.rotatedCookie
                ? this.stateRepo.encryptMamCookie(pointsResult.rotatedCookie)
                : state.secrets.mamCookieEncrypted,
            },
          }, {
            action: "check",
            points: pointsResult.points,
            note: "Fetched current points.",
          });

          const buyCost = updatedState.settings.buyAmountGb * 500;
          const shouldBuy =
            updatedState.settings.autoBuyEnabled &&
            pointsResult.points >= updatedState.settings.reservePoints + buyCost;

          if (!shouldBuy) {
            return this.withComputedNextRun(updatedState);
          }

          const buyResult = await this.mamClient.buyUpload(
            this.stateRepo.decryptMamCookie(updatedState) ?? mamCookie,
            updatedState.settings.buyAmountGb,
          );

          updatedState = this.withHistory({
            ...updatedState,
            runtime: {
              ...updatedState.runtime,
              lastBuyAt: new Date().toISOString(),
              nextRunAt: null,
              updatedAt: new Date().toISOString(),
            },
            secrets: {
              ...updatedState.secrets,
              mamCookieEncrypted: buyResult.rotatedCookie
                ? this.stateRepo.encryptMamCookie(buyResult.rotatedCookie)
                : updatedState.secrets.mamCookieEncrypted,
            },
          }, {
            action: "buy",
            points: pointsResult.points,
            note: buyResult.message,
          });

          return this.withComputedNextRun(updatedState);
        } catch (error) {
          return this.withComputedNextRun(
            this.withError(state, error instanceof Error ? error.message : String(error)),
          );
        }
      });

      this.applyTimer(nextState);
      return nextState;
    } finally {
      this.running = false;
    }
  }

  async reschedule(): Promise<AppState> {
    const nextState = await this.syncScheduleMetadata();
    this.applyTimer(nextState);
    return nextState;
  }

  private scheduleNext(delayMs: number): void {
    this.stop();
    this.timer = setTimeout(async () => {
      try {
        await this.runNow();
      } catch {
        // State is already updated inside runNow; scheduler stays alive.
      }
    }, delayMs);
  }

  private withError(state: AppState, message: string): AppState {
    return {
      ...state,
      runtime: {
        ...state.runtime,
        lastRunAt: new Date().toISOString(),
        nextRunAt: null,
        lastError: message,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  private shouldRunImmediately(state: AppState): boolean {
    if (state.runtime.lastRunAt !== null) {
      return false;
    }
    return Date.now() >= this.getAnchorMs(state, Date.now());
  }

  private withComputedNextRun(state: AppState, now = Date.now()): AppState {
    return {
      ...state,
      runtime: {
        ...state.runtime,
        nextRunAt: this.computeNextRunAt(state, now),
      },
    };
  }

  private computeNextRunAt(state: AppState, now = Date.now()): string | null {
    if (!state.settings.pollingEnabled) {
      return null;
    }

    const anchorMs = this.getAnchorMs(state, now);
    if (now < anchorMs) {
      return new Date(anchorMs).toISOString();
    }

    const elapsedMs = now - anchorMs;
    const intervalsElapsed = Math.floor(elapsedMs / state.settings.intervalMs) + 1;
    return new Date(anchorMs + (intervalsElapsed * state.settings.intervalMs)).toISOString();
  }

  private applyTimer(state: AppState): void {
    if (!state.settings.pollingEnabled || !state.runtime.nextRunAt) {
      this.stop();
      return;
    }

    const nextRunMs = Date.parse(state.runtime.nextRunAt);
    if (Number.isNaN(nextRunMs)) {
      this.stop();
      return;
    }

    this.scheduleNext(Math.max(nextRunMs - Date.now(), 0));
  }

  private async syncScheduleMetadata(): Promise<AppState> {
    return this.updateState((state) => this.withComputedNextRun(state));
  }

  private getAnchorMs(state: AppState, referenceNow: number): number {
    const [hourText = "0", minuteText = "0"] = state.settings.scheduleTime.split(":");
    const hour = Math.min(Math.max(Number(hourText) || 0, 0), 23);
    const minute = Math.min(Math.max(Number(minuteText) || 0, 0), 59);
    const referenceDate = new Date(referenceNow);
    return new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
      hour,
      minute,
      0,
      0,
    ).getTime();
  }

  private withHistory(
    state: AppState,
    entry: { at?: string; points: number; action: "check" | "buy"; note: string },
  ): AppState {
    return {
      ...state,
      runtime: {
        ...state.runtime,
        history: [
          {
            at: entry.at ?? new Date().toISOString(),
            points: entry.points,
            action: entry.action,
            note: entry.note,
          },
          ...state.runtime.history,
        ].slice(0, 20),
      },
    };
  }
}
