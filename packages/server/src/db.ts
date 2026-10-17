import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  issuer TEXT NOT NULL,
  allowed_origins TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  display_name TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (app_id, external_id)
);

CREATE TABLE IF NOT EXISTS factors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  secret_ciphertext TEXT,
  algorithm TEXT,
  digits INTEGER,
  period INTEGER,
  last_accepted_step INTEGER,
  credential_id TEXT,
  public_key TEXT,
  sign_count INTEGER,
  transports TEXT,
  email_ciphertext TEXT,
  UNIQUE (user_id, type)
);

CREATE TABLE IF NOT EXISTS backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS client_sessions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_flashes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  ip TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_app ON users(app_id);
CREATE INDEX IF NOT EXISTS idx_attempts_bucket ON auth_attempts(bucket, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON client_sessions(user_id);
`;

export function openDatabase(file: string): DB {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 3000");
  if (file !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  return db;
}

export function migrate(db: DB): void {
  db.exec(SCHEMA);
  const row = db.prepare("SELECT version FROM schema_migrations LIMIT 1").get() as { version: number } | undefined;
  if (!row) {
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(1);
  }
}

export function withTransaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already closed */
    }
    throw error;
  }
}
