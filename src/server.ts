import path from "node:path";

import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { MamClient } from "./mam.js";
import { SchedulerService } from "./scheduler.js";
import type { AppState } from "./state.js";
import { StateRepository } from "./state.js";

const publicRoot = path.join(process.cwd(), "public");

const loginSchema = z.object({
  password: z.string().min(1),
});

const settingsSchema = z.object({
  pollingEnabled: z.boolean(),
  intervalMs: z.number().int().positive(),
  scheduleTime: z.string().regex(/^\d{2}:\d{2}$/),
  reservePoints: z.number().int().nonnegative(),
  autoBuyEnabled: z.boolean(),
  buyAmountGb: z.number().int().min(50),
});

const secretsSchema = z.object({
  mamCookie: z.string().trim().optional(),
  clearMamCookie: z.boolean().optional(),
});

const passwordSchema = z.object({
  newAdminPassword: z.string().min(12),
});

export async function buildServer(config: AppConfig) {
  const app = Fastify({
    logger: true,
    trustProxy: config.trustProxy,
    bodyLimit: 8 * 1024,
  });

  await app.register(cookie, {
    secret: config.masterKey,
  });
  await app.register(rateLimit, {
    max: 20,
    timeWindow: "1 minute",
  });

  const stateRepo = new StateRepository(config);
  const mamClient = new MamClient(config.requestTimeoutMs);
  const auth = new AuthService(config, stateRepo);

  let state = await stateRepo.load();
  await stateRepo.save(state);

  async function updateState(updater: (current: AppState) => Promise<AppState> | AppState): Promise<AppState> {
    state = await updater(state);
    await stateRepo.save(state);
    return state;
  }

  const scheduler = new SchedulerService(stateRepo, mamClient, updateState);
  await scheduler.start();

  function hostAllowed(hostHeader: string | undefined): boolean {
    if (!hostHeader) return false;
    if (config.allowedHosts.includes("*")) return true;
    const host = hostHeader.split(":")[0]?.toLowerCase();
    return config.allowedHosts.some((allowed) => allowed.toLowerCase() === host);
  }

  function originAllowed(request: FastifyRequest): boolean {
    const originHeader = request.headers.origin;
    if (!originHeader) return true;
    if (config.allowedOrigins.length === 0) {
      const protocol = request.headers["x-forwarded-proto"]?.toString() ?? (config.httpsOnlyCookies ? "https" : "http");
      return originHeader === `${protocol}://${request.headers.host}`;
    }
    if (config.allowedOrigins.includes("*")) return true;
    return config.allowedOrigins.includes(originHeader);
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!hostAllowed(request.headers.host)) {
      reply.code(400).send({ message: "Host header is not allowed." });
      return reply;
    }
    if (!originAllowed(request)) {
      reply.code(403).send({ message: "Origin is not allowed." });
      return reply;
    }
    return undefined;
  });

  async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    const sessionId = request.cookies.mousemerchant_session;
    if (auth.isSessionValid(sessionId)) {
      return;
    }

    reply.code(401).send({ message: "Authentication required." });
  }

  if (config.webEnabled) {
    await app.register(staticPlugin, {
      root: publicRoot,
      prefix: "/assets/",
      wildcard: false,
    });
  }

  app.get("/health", async () => ({
    ok: true,
    webEnabled: config.webEnabled,
    hasMamCookie: state.secrets.mamCookieEncrypted !== null,
  }));

  app.post("/api/login", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
  }, async (request, reply) => {
    if (!config.webEnabled) {
      reply.code(404).send({ message: "Web UI is disabled." });
      return;
    }

    const { password } = loginSchema.parse(request.body);
    const sessionId = auth.login(password, state);
    if (!sessionId) {
      reply.code(401).send({ message: "Incorrect password." });
      return;
    }

    reply.setCookie("mousemerchant_session", sessionId, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.httpsOnlyCookies,
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });

    reply.send({ ok: true });
  });

  app.post("/api/logout", async (request, reply) => {
    auth.invalidateSession(request.cookies.mousemerchant_session);
    reply.clearCookie("mousemerchant_session", { path: "/" });
    reply.send({ ok: true });
  });

  app.get("/api/state", { preHandler: requireAuth }, async () => ({
    state: stateRepo.toPublicState(state),
  }));

  app.put("/api/settings", { preHandler: requireAuth }, async (request) => {
    const nextSettings = settingsSchema.parse(request.body);
    await updateState((current) => ({
      ...current,
      settings: nextSettings,
      runtime: {
        ...current.runtime,
        updatedAt: new Date().toISOString(),
      },
    }));
    const nextState = await scheduler.reschedule();
    return { ok: true, state: stateRepo.toPublicState(nextState) };
  });

  app.put("/api/secrets", { preHandler: requireAuth }, async (request) => {
    const body = secretsSchema.parse(request.body);
    const nextState = await updateState((current) => {
      return {
        ...current,
        secrets: {
          mamCookieEncrypted: body.clearMamCookie
            ? null
            : body.mamCookie !== undefined
              ? stateRepo.encryptMamCookie(body.mamCookie || null)
              : current.secrets.mamCookieEncrypted,
        },
        runtime: {
          ...current.runtime,
          updatedAt: new Date().toISOString(),
        },
      };
    });

    return {
      ok: true,
      state: stateRepo.toPublicState(nextState),
    };
  });

  app.put("/api/admin-password", { preHandler: requireAuth }, async (request, reply) => {
    const body = passwordSchema.parse(request.body);
    const currentSessionId = request.cookies.mousemerchant_session;
    const nextState = await updateState((current) => auth.setPassword({
      ...current,
      runtime: {
        ...current.runtime,
        updatedAt: new Date().toISOString(),
      },
    }, body.newAdminPassword));

    auth.invalidateAllSessions();
    reply.clearCookie("mousemerchant_session", { path: "/" });

    return {
      ok: true,
      state: stateRepo.toPublicState(nextState),
      loggedOut: true,
      previousSessionId: currentSessionId ?? null,
    };
  });

  app.post("/api/actions/run", { preHandler: requireAuth }, async () => {
    const nextState = await scheduler.runNow();
    return { ok: true, state: stateRepo.toPublicState(nextState) };
  });

  app.post("/api/actions/buy", { preHandler: requireAuth }, async () => {
    const mamCookie = stateRepo.decryptMamCookie(state);
    if (!mamCookie) {
      throw new Error("MAM cookie is not configured.");
    }

    const now = new Date().toISOString();
    const buyResult = await mamClient.buyUpload(mamCookie, state.settings.buyAmountGb);
    const nextState = await updateState((current) => ({
      ...current,
      secrets: {
        ...current.secrets,
        mamCookieEncrypted: buyResult.rotatedCookie
          ? stateRepo.encryptMamCookie(buyResult.rotatedCookie)
          : current.secrets.mamCookieEncrypted,
      },
      runtime: {
        ...current.runtime,
        lastPoints: buyResult.points ?? current.runtime.lastPoints,
        lastRunAt: now,
        lastBuyAt: now,
        lastError: null,
        updatedAt: now,
        history: [
          {
            at: now,
            points: buyResult.points ?? current.runtime.lastPoints ?? 0,
            action: "buy" as const,
            note: buyResult.message,
          },
          ...current.runtime.history,
        ].slice(0, 20),
      },
    }));
    return { ok: true, message: buyResult.message, state: stateRepo.toPublicState(nextState) };
  });

  if (config.webEnabled) {
    app.get("/", async (_request, reply) => {
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      name: "mousemerchant",
      webEnabled: false,
      health: "/health",
    }));
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    if (error instanceof z.ZodError) {
      reply.code(400).send({ message: "Invalid request payload.", issues: error.issues });
      return;
    }
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    reply.code(statusCode).send({ message: error instanceof Error ? error.message : "Internal server error" });
  });

  app.addHook("onClose", async () => {
    scheduler.stop();
  });

  return app;
}
