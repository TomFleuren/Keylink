import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import type { DB } from "../db.js";
import { newId, newToken, sha256, slugify } from "../ids.js";
import { HttpError } from "../http/errors.js";
import { audit } from "./audit.js";
import { parseStoredOrigins } from "./origins.js";

export type AppRow = {
  id: string;
  name: string;
  slug: string;
  issuer: string;
  allowed_origins: string;
  created_at: number;
  updated_at: number;
};

export type ApiKeyRow = {
  id: string;
  app_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export function listApps(db: DB): AppRow[] {
  return db.prepare("SELECT * FROM apps ORDER BY created_at ASC").all() as unknown as AppRow[];
}

export function getApp(db: DB, id: string): AppRow | undefined {
  return db.prepare("SELECT * FROM apps WHERE id = ?").get(id) as AppRow | undefined;
}

export function getAppBySlug(db: DB, slug: string): AppRow | undefined {
  return db.prepare("SELECT * FROM apps WHERE slug = ?").get(slug) as AppRow | undefined;
}

export function createApp(db: DB, input: { name: string; issuer?: string; origins: string[] }, now = Date.now()): AppRow {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new HttpError(400, "invalid_name", "Application name must be 1–80 characters.");
  }
  let slug = slugify(name);
  if (getAppBySlug(db, slug)) slug = `${slug}-${newId("s").slice(-6).toLowerCase()}`;
  const id = newId("app");
  const issuer = (input.issuer?.trim() || name).slice(0, 80);
  db.prepare(
    `INSERT INTO apps (id, name, slug, issuer, allowed_origins, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, slug, issuer, JSON.stringify(input.origins), now, now);
  audit(db, { appId: id, action: "app.created", detail: name }, now);
  return getApp(db, id)!;
}

export function updateApp(
  db: DB,
  id: string,
  input: { name?: string; issuer?: string; origins?: string[] },
  now = Date.now(),
): AppRow {
  const current = getApp(db, id);
  if (!current) throw new HttpError(404, "not_found", "Application not found.");
  const name = input.name?.trim() || current.name;
  const issuer = input.issuer?.trim() || current.issuer;
  const origins = input.origins ?? parseStoredOrigins(current.allowed_origins);
  db.prepare("UPDATE apps SET name = ?, issuer = ?, allowed_origins = ?, updated_at = ? WHERE id = ?").run(
    name,
    issuer,
    JSON.stringify(origins),
    now,
    id,
  );
  audit(db, { appId: id, action: "app.updated", detail: name }, now);
  return getApp(db, id)!;
}

export function deleteApp(db: DB, id: string, now = Date.now()): void {
  const current = getApp(db, id);
  if (!current) throw new HttpError(404, "not_found", "Application not found.");
  audit(db, { appId: id, action: "app.deleted", detail: current.name }, now);
  db.prepare("DELETE FROM apps WHERE id = ?").run(id);
}

export function listKeys(db: DB, appId: string): ApiKeyRow[] {
  return db.prepare("SELECT * FROM api_keys WHERE app_id = ? ORDER BY created_at DESC").all(appId) as unknown as ApiKeyRow[];
}

export function issueApiKey(db: DB, appId: string, name: string, now = Date.now()): { row: ApiKeyRow; token: string } {
  if (!getApp(db, appId)) throw new HttpError(404, "not_found", "Application not found.");
  const label = name.trim() || "Default";
  if (label.length > 80) throw new HttpError(400, "invalid_name", "Key name must be 80 characters or fewer.");
  const token = newToken("kl_live");
  const id = newId("key");
  const prefix = token.slice(0, 16);
  db.prepare(
    `INSERT INTO api_keys (id, app_id, name, prefix, key_hash, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(id, appId, label, prefix, sha256(token), now);
  audit(db, { appId, action: "api_key.created", detail: `${label} (${prefix}…)` }, now);
  return { row: listKeys(db, appId).find((key) => key.id === id)!, token };
}

export function revokeApiKey(db: DB, appId: string, keyId: string, now = Date.now()): void {
  const row = db.prepare("SELECT * FROM api_keys WHERE id = ? AND app_id = ?").get(keyId, appId) as ApiKeyRow | undefined;
  if (!row) throw new HttpError(404, "not_found", "API key not found.");
  db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").run(now, keyId);
  audit(db, { appId, action: "api_key.revoked", detail: row.prefix }, now);
}

export type AuthedApp = { app: AppRow; key: ApiKeyRow };

export function authenticateApiKey(db: DB, token: string, now = Date.now()): AuthedApp | null {
  if (!token.startsWith("kl_live_")) return null;
  const row = db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(sha256(token)) as ApiKeyRow | undefined;
  if (!row || row.revoked_at) return null;
  const app = getApp(db, row.app_id);
  if (!app) return null;
  if (!row.last_used_at || now - row.last_used_at > 60_000) {
    db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now, row.id);
  }
  return { app, key: row };
}

export function bootstrapApp(db: DB, config: Config): void {
  if (!config.bootstrapApp) return;
  let app = db.prepare("SELECT * FROM apps WHERE name = ?").get(config.bootstrapApp) as AppRow | undefined;
  if (!app) {
    app = createApp(db, { name: config.bootstrapApp, origins: config.bootstrapOrigins });
  } else if (config.bootstrapOrigins.length > 0) {
    const existing = parseStoredOrigins(app.allowed_origins);
    const merged = [...existing];
    for (const origin of config.bootstrapOrigins) {
      if (!merged.includes(origin)) merged.push(origin);
    }
    if (merged.length !== existing.length) updateApp(db, app.id, { origins: merged });
  }
  const active = listKeys(db, app.id).filter((key) => !key.revoked_at);
  const file = path.join(config.dataDir, "bootstrap-api-key");
  if (active.length > 0) return;
  const issued = issueApiKey(db, app.id, "Bootstrap");
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(file, issued.token + "\n", { mode: 0o600 });
}
