import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { safeEqualString } from "../crypto/compare.js";
import { checkAdminPassword, randomToken } from "../crypto/password.js";
import type { DB } from "../db.js";
import { parseCookies, serializeCookie, themeCookie } from "../http/cookies.js";
import { HttpError } from "../http/errors.js";
import { loginPage } from "../http/html.js";
import { newId } from "../ids.js";
import { appDetailPage, appsPage, auditPage } from "../admin/pages.js";
import {
  createApp,
  deleteApp,
  getApp,
  issueApiKey,
  listApps,
  listKeys,
  revokeApiKey,
  updateApp,
} from "../services/apps.js";
import { parseOriginList } from "../services/origins.js";
import { backupRemaining, deleteUser, factorsFor, listUsers, unlockUser } from "../services/users.js";
import type { Ctx } from "../types.js";
import { attemptCount, noteAttempt } from "../services/rate.js";

type AdminSession = { id: string; csrf: string };

function cookiesOf(request: FastifyRequest): Record<string, string> {
  return parseCookies(request.headers.cookie);
}

function themeOf(request: FastifyRequest): string | null {
  const theme = cookiesOf(request).kl_theme;
  return theme === "light" || theme === "dark" ? theme : null;
}

function bodyOf(request: FastifyRequest): Record<string, string> {
  const body = request.body;
  if (!body || typeof body !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number") out[key] = String(value);
  }
  return out;
}

function loadSession(db: DB, request: FastifyRequest, now = Date.now()): AdminSession | null {
  const id = cookiesOf(request).kl_session;
  if (!id) return null;
  const row = db.prepare("SELECT id, csrf, expires_at FROM admin_sessions WHERE id = ?").get(id) as
    | { id: string; csrf: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at <= now) return null;
  return { id: row.id, csrf: row.csrf };
}

function requireSession(ctx: Ctx, request: FastifyRequest): AdminSession {
  const session = loadSession(ctx.db, request);
  if (!session) throw new HttpError(401, "unauthorized", "Sign in required.");
  return session;
}

function assertCsrf(session: AdminSession, request: FastifyRequest): void {
  const body = bodyOf(request);
  const header = request.headers["x-keylink-csrf"];
  const presented = body.csrf || (typeof header === "string" ? header : "");
  if (!presented || !safeEqualString(presented, session.csrf)) {
    throw new HttpError(403, "csrf", "The form expired. Reload the page and try again.");
  }
}

function cookieSecure(ctx: Ctx): boolean {
  return ctx.config.publicUrl.startsWith("https:");
}

function setSessionCookie(reply: FastifyReply, ctx: Ctx, id: string, ttlMs: number): void {
  reply.header("set-cookie", serializeCookie("kl_session", id, { maxAge: Math.floor(ttlMs / 1000), secure: cookieSecure(ctx) }));
}

function sendHtml(reply: FastifyReply, html: string, status = 200) {
  return reply
    .code(status)
    .type("text/html; charset=utf-8")
    .header(
      "content-security-policy",
      "default-src 'self'; style-src 'self'; font-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )
    .send(html);
}

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/admin")) return "/admin";
  if (value.startsWith("//") || value.includes("\\")) return "/admin";
  return value;
}

function takeFlash(db: DB, sessionId: string): { kind: string; body: string } | null {
  const row = db.prepare("SELECT id, kind, body FROM admin_flashes WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId) as
    | { id: string; kind: string; body: string }
    | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM admin_flashes WHERE session_id = ?").run(sessionId);
  return { kind: row.kind, body: row.body };
}

function setFlash(db: DB, sessionId: string, kind: string, body: string, now = Date.now()): void {
  db.prepare("DELETE FROM admin_flashes WHERE session_id = ?").run(sessionId);
  db.prepare("INSERT INTO admin_flashes (id, session_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
    newId("flash"),
    sessionId,
    kind,
    body,
    now,
  );
}

export function registerAdmin(app: FastifyInstance, ctx: Ctx): void {
  app.get("/admin/login", async (request, reply) => {
    if (loadSession(ctx.db, request)) return reply.redirect("/admin");
    return sendHtml(reply, loginPage({ theme: themeOf(request) }));
  });

  app.post("/admin/login", async (request, reply) => {
    const bucket = `admin:${request.ip}`;
    const limited = attemptCount(ctx.db, bucket, 15 * 60 * 1000) >= 12;
    const body = bodyOf(request);
    const password = body.password ?? "";
    const ok =
      !limited &&
      password.length > 0 &&
      password.length <= 200 &&
      checkAdminPassword(password, ctx.adminHash, ctx.config.scryptN);
    if (!ok) {
      noteAttempt(ctx.db, bucket);
      return sendHtml(reply, loginPage({ theme: themeOf(request), error: "That password was not accepted." }), 401);
    }
    const id = newId("adm");
    const csrf = randomToken(24);
    const now = Date.now();
    ctx.db
      .prepare("INSERT INTO admin_sessions (id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(id, csrf, now, now + ctx.config.adminTtlMs);
    setSessionCookie(reply, ctx, id, ctx.config.adminTtlMs);
    return reply.redirect("/admin");
  });

  app.post("/admin/logout", async (request, reply) => {
    const session = loadSession(ctx.db, request);
    if (session) {
      assertCsrf(session, request);
      ctx.db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(session.id);
    }
    reply.header("set-cookie", serializeCookie("kl_session", "", { clear: true, secure: cookieSecure(ctx) }));
    return reply.redirect("/admin/login");
  });

  app.post("/admin/theme", async (request, reply) => {
    const body = bodyOf(request);
    const theme = body.theme === "dark" ? "dark" : "light";
    reply.header("set-cookie", themeCookie(theme, cookieSecure(ctx)));
    return reply.redirect(safeNext(body.next));
  });

  app.get("/admin", async (request, reply) => {
    const session = requireSession(ctx, request);
    const apps = listApps(ctx.db).map((entry) => {
      const users = (ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE app_id = ?").get(entry.id) as { n: number }).n;
      const keys = (ctx.db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE app_id = ? AND revoked_at IS NULL").get(entry.id) as { n: number }).n;
      return { app: entry, users, keys };
    });
    return sendHtml(reply, appsPage({ theme: themeOf(request), csrf: session.csrf, apps }));
  });

  app.post("/admin/apps", async (request, reply) => {
    const session = requireSession(ctx, request);
    assertCsrf(session, request);
    const body = bodyOf(request);
    const parsed = parseOriginList(body.origins ?? "");
    if (parsed.invalid.length) {
      const apps = listApps(ctx.db).map((entry) => ({
        app: entry,
        users: 0,
        keys: 0,
      }));
      return sendHtml(
        reply,
        appsPage({ theme: themeOf(request), csrf: session.csrf, apps, error: `Invalid origin: ${parsed.invalid[0]}` }),
        400,
      );
    }
    const created = createApp(ctx.db, { name: body.name ?? "", origins: parsed.origins, issuer: body.issuer });
    return reply.redirect(`/admin/apps/${created.id}`);
  });

  app.get("/admin/apps/:id", async (request, reply) => {
    const session = requireSession(ctx, request);
    const { id } = request.params as { id: string };
    const found = getApp(ctx.db, id);
    if (!found) throw new HttpError(404, "not_found", "Application not found.");
    const flash = takeFlash(ctx.db, session.id);
    const users = listUsers(ctx.db, found.id).map((user) => {
      const factor = factorsFor(ctx.db, user.id).find((item) => item.type === "totp");
      return { user, factor: factor?.status ?? "none", backup: backupRemaining(ctx.db, user.id) };
    });
    return sendHtml(
      reply,
      appDetailPage({
        theme: themeOf(request),
        csrf: session.csrf,
        app: found,
        keys: listKeys(ctx.db, found.id),
        users,
        issuedKey: flash?.kind === "key" ? flash.body : undefined,
        notice: flash?.kind === "notice" ? flash.body : undefined,
      }),
    );
  });

  app.post("/admin/apps/:id", async (request, reply) => {
    const session = requireSession(ctx, request);
    assertCsrf(session, request);
    const { id } = request.params as { id: string };
    const body = bodyOf(request);
    const parsed = parseOriginList(body.origins ?? "");
    if (parsed.invalid.length) {
      setFlash(ctx.db, session.id, "notice", `Invalid origin: ${parsed.invalid[0]}`);
      return reply.redirect(`/admin/apps/${id}`);
    }
    updateApp(ctx.db, id, { name: body.name, issuer: body.issuer, origins: parsed.origins });
    setFlash(ctx.db, session.id, "notice", "Settings saved.");
    return reply.redirect(`/admin/apps/${id}`);
  });

  app.post("/admin/apps/:id/keys", async (request, reply) => {
    const session = requireSession(ctx, request);
    assertCsrf(session, request);
    const { id } = request.params as { id: string };
    const body = bodyOf(request);
    const issued = issueApiKey(ctx.db, id, body.name || "Default");
    setFlash(ctx.db, session.id, "key", issued.token);
    return reply.redirect(`/admin/apps/${id}`);
  });

  app.post("/admin/apps/:id/keys/:keyId/revoke", async (request, reply) => {
    const session = requireSession(ctx, request);
    assertCsrf(session, request);
    const { id, keyId } = request.params as { id: string; keyId: string };
    revokeApiKey(ctx.db, id, keyId);
    setFlash(ctx.db, session.id, "notice", "API key revoked.");
    return reply.redirect(`/admin/apps/${id}`);
  });

  app.post("/admin/apps/:id/delete", async (request, reply) => {
    const session = requireSession(ctx, request);
    assertCsrf(session, request);
    const { id } = request.params as { id: string };
    const body = bodyOf(request);
    if (body.confirm !== "yes") throw new HttpError(400, "confirm", "Confirm deletion to continue.");
    deleteApp(ctx.db, id);
    return reply.redirect("/admin");
  });

  app.post("/admin/users/:id/unlock", async (request, reply) => {
    const session = requireSession(ctx, request);
    assertCsrf(session, request);
    const { id } = request.params as { id: string };
    const user = ctx.db.prepare("SELECT app_id FROM users WHERE id = ?").get(id) as { app_id: string } | undefined;
    if (!user) throw new HttpError(404, "not_found", "User not found.");
    unlockUser(ctx.db, id);
    setFlash(ctx.db, session.id, "notice", "User unlocked.");
    return reply.redirect(`/admin/apps/${user.app_id}`);
  });

  app.post("/admin/users/:id/delete", async (request, reply) => {
    const session = requireSession(ctx, request);
    assertCsrf(session, request);
    const { id } = request.params as { id: string };
    const user = ctx.db.prepare("SELECT app_id FROM users WHERE id = ?").get(id) as { app_id: string } | undefined;
    if (!user) throw new HttpError(404, "not_found", "User not found.");
    deleteUser(ctx.db, id);
    setFlash(ctx.db, session.id, "notice", "User removed.");
    return reply.redirect(`/admin/apps/${user.app_id}`);
  });

  app.get("/admin/audit", async (request, reply) => {
    const session = requireSession(ctx, request);
    const events = ctx.db
      .prepare(
        `SELECT e.created_at, e.action, e.detail, e.ip, a.name AS app_name
         FROM audit_events e
         LEFT JOIN apps a ON a.id = e.app_id
         ORDER BY e.created_at DESC
         LIMIT 200`,
      )
      .all() as { created_at: number; action: string; detail: string | null; ip: string | null; app_name: string | null }[];
    return sendHtml(reply, auditPage({ theme: themeOf(request), csrf: session.csrf, events }));
  });
}

