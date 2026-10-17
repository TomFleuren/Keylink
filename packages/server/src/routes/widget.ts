import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "../http/errors.js";
import { parseStoredOrigins } from "../services/origins.js";
import { hitIpLimit } from "../services/rate.js";
import { confirmSession, sessionFromToken, widgetPayload } from "../services/totp-flow.js";
import { getApp } from "../services/apps.js";
import type { Ctx } from "../types.js";

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header) return "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? "";
}

function originAllowedAnywhere(ctx: Ctx, origin: string): boolean {
  const rows = ctx.db.prepare("SELECT allowed_origins FROM apps").all() as { allowed_origins: string }[];
  return rows.some((row) => parseStoredOrigins(row.allowed_origins).includes(origin));
}

function applyCors(ctx: Ctx, request: FastifyRequest, reply: FastifyReply, allowed: string[] | null): void {
  const origin = request.headers.origin;
  if (!origin || typeof origin !== "string") return;
  const ok = allowed ? allowed.includes(origin) : originAllowedAnywhere(ctx, origin);
  if (!ok) {
    throw new HttpError(403, "origin_not_allowed", "This origin is not allowed for the application.");
  }
  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-headers", "Authorization, Content-Type");
  reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
  reply.header("access-control-max-age", "600");
}

export function registerWidget(app: FastifyInstance, ctx: Ctx): void {
  app.options("/v1/widget/*", async (request, reply) => {
    applyCors(ctx, request, reply, null);
    return reply.code(204).send();
  });

  app.get("/v1/widget/session", async (request, reply) => {
    const session = sessionFromToken(ctx.db, bearer(request));
    const appRow = getApp(ctx.db, session.app_id);
    applyCors(ctx, request, reply, appRow ? parseStoredOrigins(appRow.allowed_origins) : []);
    return widgetPayload(ctx.db, ctx.config, session);
  });

  app.post("/v1/widget/confirm", async (request, reply) => {
    const limit = hitIpLimit(ctx.db, request.ip || "unknown", ctx.config.ipRateLimit, ctx.config.ipRateWindowMs);
    if (limit.limited) {
      reply.header("retry-after", String(limit.retryAfter));
      throw new HttpError(429, "rate_limited", "Too many attempts from this address.", { retryAfter: limit.retryAfter });
    }
    const session = sessionFromToken(ctx.db, bearer(request));
    const appRow = getApp(ctx.db, session.app_id);
    applyCors(ctx, request, reply, appRow ? parseStoredOrigins(appRow.allowed_origins) : []);
    const body = request.body as { code?: unknown } | undefined;
    if (!body || typeof body.code !== "string" || !body.code.trim()) {
      throw new HttpError(400, "invalid_code", "Enter the code from your authenticator.");
    }
    return confirmSession(ctx.db, ctx.config, session, body.code, request.ip);
  });
}
