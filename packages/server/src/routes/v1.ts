import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "../http/errors.js";
import { listFactors } from "../factors/registry.js";
import { assertEmailAvailable } from "../factors/email.js";
import { assertWebauthnAvailable } from "../factors/webauthn.js";
import { authenticateApiKey, type AuthedApp } from "../services/apps.js";
import { hitIpLimit } from "../services/rate.js";
import {
  beginEnrollment,
  beginVerify,
  consumeSession,
  disableTotp,
  regenerateBackupCodes,
  sessionView,
  verifyUserCode,
} from "../services/totp-flow.js";
import { getUser, upsertUser, userStatus } from "../services/users.js";
import type { Ctx } from "../types.js";

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header) return "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? "";
}

function requireApp(ctx: Ctx, request: FastifyRequest): AuthedApp {
  const auth = authenticateApiKey(ctx.db, bearer(request));
  if (!auth) throw new HttpError(401, "unauthorized", "API key is missing or not valid.");
  return auth;
}

function jsonBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) return {};
  return request.body as Record<string, unknown>;
}

function displayName(body: Record<string, unknown>): string | undefined {
  return typeof body.displayName === "string" ? body.displayName : undefined;
}

function requireCode(body: Record<string, unknown>): string {
  if (typeof body.code !== "string" || !body.code.trim()) {
    throw new HttpError(400, "invalid_code", "Provide a code.");
  }
  return body.code;
}

export function registerV1(app: FastifyInstance, ctx: Ctx): void {
  app.get("/v1/factors", async (request) => {
    requireApp(ctx, request);
    return { factors: listFactors() };
  });

  app.put("/v1/users/:externalId", async (request) => {
    const { app: owner } = requireApp(ctx, request);
    const { externalId } = request.params as { externalId: string };
    const user = upsertUser(ctx.db, owner, externalId, displayName(jsonBody(request)));
    return userStatus(ctx.db, user);
  });

  app.get("/v1/users/:externalId", async (request) => {
    const { app: owner } = requireApp(ctx, request);
    const { externalId } = request.params as { externalId: string };
    const user = getUser(ctx.db, owner.id, externalId);
    if (!user) throw new HttpError(404, "not_found", "User not found.");
    return userStatus(ctx.db, user);
  });

  app.post("/v1/users/:externalId/sessions", async (request) => {
    const { app: owner } = requireApp(ctx, request);
    const { externalId } = request.params as { externalId: string };
    const body = jsonBody(request);
    const purpose = body.purpose;
    if (purpose !== "enroll" && purpose !== "verify") {
      throw new HttpError(400, "invalid_purpose", 'purpose must be "enroll" or "verify".');
    }
    const user = upsertUser(ctx.db, owner, externalId, displayName(body));
    if (purpose === "enroll") return beginEnrollment(ctx.db, ctx.config, owner, user);
    return beginVerify(ctx.db, ctx.config, owner, user);
  });

  app.get("/v1/sessions/:sessionId", async (request) => {
    const { app: owner } = requireApp(ctx, request);
    const { sessionId } = request.params as { sessionId: string };
    const view = sessionView(ctx.db, sessionId);
    if (view && owner) {
      const row = ctx.db.prepare("SELECT app_id FROM client_sessions WHERE id = ?").get(sessionId) as { app_id: string } | undefined;
      if (!row || row.app_id !== owner.id) throw new HttpError(404, "not_found", "Session not found.");
    }
    return view;
  });

  app.post("/v1/sessions/:sessionId/consume", async (request) => {
    const { app: owner } = requireApp(ctx, request);
    const { sessionId } = request.params as { sessionId: string };
    return consumeSession(ctx.db, owner, sessionId);
  });

  app.post("/v1/users/:externalId/verify", async (request, reply) => {
    const { app: owner } = requireApp(ctx, request);
    guardIp(ctx, request, reply);
    const { externalId } = request.params as { externalId: string };
    const user = getUser(ctx.db, owner.id, externalId);
    if (!user) throw new HttpError(404, "not_found", "User not found.");
    const factor = verifyUserCode(ctx.db, ctx.config, user, requireCode(jsonBody(request)), request.ip);
    return { ok: true, factor, user: userStatus(ctx.db, getUser(ctx.db, owner.id, externalId)!) };
  });

  app.post("/v1/users/:externalId/backup-codes", async (request) => {
    const { app: owner } = requireApp(ctx, request);
    const { externalId } = request.params as { externalId: string };
    const user = getUser(ctx.db, owner.id, externalId);
    if (!user) throw new HttpError(404, "not_found", "User not found.");
    return { codes: regenerateBackupCodes(ctx.db, ctx.config, user) };
  });

  app.delete("/v1/users/:externalId/totp", async (request) => {
    const { app: owner } = requireApp(ctx, request);
    const { externalId } = request.params as { externalId: string };
    const user = getUser(ctx.db, owner.id, externalId);
    if (!user) throw new HttpError(404, "not_found", "User not found.");
    disableTotp(ctx.db, user);
    return { ok: true, user: userStatus(ctx.db, getUser(ctx.db, owner.id, externalId)!) };
  });

  app.post("/v1/users/:externalId/webauthn/register", async () => {
    assertWebauthnAvailable();
  });

  app.post("/v1/users/:externalId/email/challenge", async () => {
    assertEmailAvailable();
  });
}

function guardIp(ctx: Ctx, request: FastifyRequest, reply: FastifyReply): void {
  const limit = hitIpLimit(ctx.db, request.ip || "unknown", ctx.config.ipRateLimit, ctx.config.ipRateWindowMs);
  if (limit.limited) {
    reply.header("retry-after", String(limit.retryAfter));
    throw new HttpError(429, "rate_limited", "Too many attempts from this address.", { retryAfter: limit.retryAfter });
  }
}

export { guardIp };
