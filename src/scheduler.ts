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
    if (state.settings.pollingEnabled) {
      await this.runNow();
    } else {
      this.stop();
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
            return updatedState;
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

          return updatedState;
        } catch (error) {
          return this.withError(state, error instanceof Error ? error.message : String(error));
        }
      });

      if (nextState.settings.pollingEnabled) {
        this.scheduleNext(nextState.settings.intervalMs);
      } else {
        this.stop();
      }
      return nextState;
    } finally {
      this.running = false;
    }
  }

  reschedule(state: AppState): void {
    this.stop();
    if (state.settings.pollingEnabled) {
      this.scheduleNext(state.settings.intervalMs);
    }
  }

  private scheduleNext(intervalMs: number): void {
    this.stop();
    this.timer = setTimeout(async () => {
      try {
        await this.runNow();
      } catch {
        // State is already updated inside runNow; scheduler stays alive.
      }
    }, intervalMs);
  }

  private withError(state: AppState, message: string): AppState {
    return {
      ...state,
      runtime: {
        ...state.runtime,
        lastRunAt: new Date().toISOString(),
        lastError: message,
        updatedAt: new Date().toISOString(),
      },
    };
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
