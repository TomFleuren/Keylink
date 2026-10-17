import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { placard } from "./admin/pages.js";
import type { Config } from "./config.js";
import { hashAdminPassword } from "./crypto/password.js";
import { migrate, openDatabase, type DB } from "./db.js";
import { FactorUnavailable } from "./factors/types.js";
import { HttpError } from "./http/errors.js";
import { registerAdmin } from "./routes/admin.js";
import { registerV1 } from "./routes/v1.js";
import { registerWidget } from "./routes/widget.js";
import { bootstrapApp } from "./services/apps.js";
import { parseStoredOrigins } from "./services/origins.js";
import type { Ctx } from "./types.js";
import { VERSION } from "./version.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");
const widgetFile = path.resolve(here, "../../widget/dist/keylink.js");

const FILES: Record<string, { file: string; type: string }> = {
  "/fonts.css": { file: path.join(publicDir, "fonts.css"), type: "text/css; charset=utf-8" },
  "/favicon.svg": { file: path.join(publicDir, "favicon.svg"), type: "image/svg+xml" },
  "/admin/assets/admin.css": { file: path.join(publicDir, "admin.css"), type: "text/css; charset=utf-8" },
  "/admin/assets/admin.js": { file: path.join(publicDir, "admin.js"), type: "text/javascript; charset=utf-8" },
};

function sendFile(reply: FastifyReply, file: string, type: string, cache: string) {
  return reply.type(type).header("cache-control", cache).send(createReadStream(file));
}

function widgetCors(ctx: Ctx, request: FastifyRequest, reply: FastifyReply): void {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !origin) return;
  const rows = ctx.db.prepare("SELECT allowed_origins FROM apps").all() as { allowed_origins: string }[];
  const ok = rows.some((row) => parseStoredOrigins(row.allowed_origins).includes(origin));
  if (!ok) return;
  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-headers", "Authorization, Content-Type");
  reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
}

export async function buildApp(options: { config: Config; db?: DB }): Promise<FastifyInstance> {
  const config = options.config;
  const db = options.db ?? openDatabase(config.databasePath);
  migrate(db);
  bootstrapApp(db, config);
  const ctx: Ctx = {
    config,
    db,
    adminHash: hashAdminPassword(config.adminPassword, config.scryptN),
  };
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie"] },
    bodyLimit: 64 * 1024,
    trustProxy: process.env.KEYLINK_TRUST_PROXY === "1",
  });
  await app.register(formbody);
  app.decorate("ctx", ctx);

  app.setErrorHandler((error, request, reply) => {
    if (request.url.startsWith("/v1/widget")) widgetCors(ctx, request, reply);
    if (error instanceof FactorUnavailable) {
      return reply.code(501).send({ error: { code: "factor_not_implemented", message: error.message, factor: error.factor } });
    }
    const httpError = error instanceof HttpError ? error : null;
    const status = httpError?.status ?? ((error as { statusCode?: number }).statusCode || 500);
    const code = httpError?.code ?? (status === 400 ? "bad_request" : "internal");
    const message = httpError?.message ?? (status < 500 ? "Bad request." : "Something went wrong.");
    if (!httpError && status >= 500) request.log.error({ err: error }, "request failed");
    if (request.url.startsWith("/admin") && status === 401) return reply.redirect("/admin/login");
    if (httpError?.extra.retryAfter) reply.header("retry-after", String(httpError.extra.retryAfter));
    if (request.url.startsWith("/admin") && request.headers.accept?.includes("text/html")) {
      return reply.code(status).type("text/html; charset=utf-8").send(`<!doctype html><title>Keylink</title><p>${message}</p>`);
    }
    return reply.code(status).send({ error: { code, message, ...(httpError?.extra ?? {}) } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/admin")) {
      return reply.code(404).type("text/html; charset=utf-8").send("<!doctype html><title>Not found · Keylink</title><p>That page is not in the console.</p>");
    }
    return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
  });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
  });

  app.get("/health", async () => ({ ok: true, version: VERSION }));
  app.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(placard(VERSION));
  });

  for (const [url, asset] of Object.entries(FILES)) {
    app.get(url, async (_request, reply) => {
      if (url === "/fonts.css") reply.header("access-control-allow-origin", "*");
      return sendFile(reply, asset.file, asset.type, "public, max-age=3600");
    });
  }

  app.get("/fonts/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!/^[a-z0-9-]+\.woff2$/.test(file)) throw new HttpError(404, "not_found", "Not found.");
    const full = path.join(publicDir, "fonts", file);
    try {
      await access(full);
    } catch {
      throw new HttpError(404, "not_found", "Font not found.");
    }
    reply.header("cross-origin-resource-policy", "cross-origin");
    reply.header("access-control-allow-origin", "*");
    return sendFile(reply, full, "font/woff2", "public, max-age=86400");
  });

  app.get("/widget.js", async (_request, reply) => {
    try {
      await access(widgetFile);
    } catch {
      throw new HttpError(404, "widget_missing", "Widget bundle is missing. Build @keylink/widget first.");
    }
    reply.header("cross-origin-resource-policy", "cross-origin");
    reply.header("access-control-allow-origin", "*");
    return sendFile(reply, widgetFile, "text/javascript; charset=utf-8", "public, max-age=300");
  });

  registerAdmin(app, ctx);
  registerV1(app, ctx);
  registerWidget(app, ctx);
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: Ctx;
  }
}
