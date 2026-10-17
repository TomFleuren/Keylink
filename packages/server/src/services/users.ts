import type { DB } from "../db.js";
import { newId } from "../ids.js";
import { HttpError } from "../http/errors.js";
import { audit } from "./audit.js";
import type { AppRow } from "./apps.js";

export type UserRow = {
  id: string;
  app_id: string;
  external_id: string;
  display_name: string | null;
  failed_attempts: number;
  locked_until: number | null;
  created_at: number;
  updated_at: number;
};

export type FactorRow = {
  id: string;
  user_id: string;
  type: string;
  status: string;
  created_at: number;
  confirmed_at: number | null;
  secret_ciphertext: string | null;
  algorithm: string | null;
  digits: number | null;
  period: number | null;
  last_accepted_step: number | null;
  credential_id: string | null;
  public_key: string | null;
  sign_count: number | null;
  transports: string | null;
  email_ciphertext: string | null;
};

const EXTERNAL_ID = /^[A-Za-z0-9_.:@+\-]{1,128}$/;

export function assertExternalId(externalId: string): void {
  if (!EXTERNAL_ID.test(externalId)) {
    throw new HttpError(
      400,
      "invalid_user",
      "User id must be 1–128 characters and contain only letters, numbers, and . _ : @ + -",
    );
  }
}

export function getUser(db: DB, appId: string, externalId: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE app_id = ? AND external_id = ?").get(appId, externalId) as UserRow | undefined;
}

export function getUserById(db: DB, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function listUsers(db: DB, appId: string): UserRow[] {
  return db.prepare("SELECT * FROM users WHERE app_id = ? ORDER BY created_at DESC").all(appId) as unknown as UserRow[];
}

export function upsertUser(
  db: DB,
  app: AppRow,
  externalId: string,
  displayName: string | undefined,
  now = Date.now(),
): UserRow {
  assertExternalId(externalId);
  const name = displayName?.trim() ? displayName.trim().slice(0, 120) : null;
  const existing = getUser(db, app.id, externalId);
  if (existing) {
    if (name && name !== existing.display_name) {
      db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(name, now, existing.id);
    }
    return getUserById(db, existing.id)!;
  }
  const id = newId("user");
  db.prepare(
    `INSERT INTO users (id, app_id, external_id, display_name, failed_attempts, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
  ).run(id, app.id, externalId, name, now, now);
  audit(db, { appId: app.id, userId: id, action: "user.created", detail: externalId }, now);
  return getUserById(db, id)!;
}

export function factorsFor(db: DB, userId: string): FactorRow[] {
  return db.prepare("SELECT * FROM factors WHERE user_id = ? ORDER BY created_at ASC").all(userId) as unknown as FactorRow[];
}

export function activeTotp(db: DB, userId: string): FactorRow | undefined {
  return db.prepare("SELECT * FROM factors WHERE user_id = ? AND type = 'totp' AND status = 'active'").get(userId) as
    | FactorRow
    | undefined;
}

export function backupRemaining(db: DB, userId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM backup_codes WHERE user_id = ? AND used_at IS NULL").get(userId) as {
    n: number;
  };
  return row.n;
}

export function userStatus(db: DB, user: UserRow) {
  const factors = factorsFor(db, user.id).map((factor) => ({
    type: factor.type,
    status: factor.status,
    confirmedAt: factor.confirmed_at,
  }));
  return {
    id: user.id,
    externalId: user.external_id,
    displayName: user.display_name,
    enrolled: factors.some((factor) => factor.type === "totp" && factor.status === "active"),
    lockedUntil: user.locked_until,
    failedAttempts: user.failed_attempts,
    factors,
    backupCodesRemaining: backupRemaining(db, user.id),
  };
}

export function unlockUser(db: DB, userId: string, now = Date.now()): void {
  const user = getUserById(db, userId);
  if (!user) throw new HttpError(404, "not_found", "User not found.");
  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(now, userId);
  audit(db, { appId: user.app_id, userId, action: "user.unlocked" }, now);
}

export function deleteUser(db: DB, userId: string, now = Date.now()): void {
  const user = getUserById(db, userId);
  if (!user) throw new HttpError(404, "not_found", "User not found.");
  audit(db, { appId: user.app_id, userId, action: "user.deleted", detail: user.external_id }, now);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

export function assertNotLocked(user: UserRow, now: number): void {
  if (user.locked_until && user.locked_until > now) {
    const retryAfter = Math.ceil((user.locked_until - now) / 1000);
    throw new HttpError(423, "locked", "Too many attempts. Try again later.", {
      lockedUntil: user.locked_until,
      retryAfter,
    });
  }
}

export function recordFailure(db: DB, user: UserRow, maxFailures: number, lockoutMs: number, now: number): number {
  const attempts = user.failed_attempts + 1;
  if (attempts >= maxFailures) {
    const lockedUntil = now + lockoutMs;
    db.prepare("UPDATE users SET failed_attempts = 0, locked_until = ?, updated_at = ? WHERE id = ?").run(
      lockedUntil,
      now,
      user.id,
    );
    audit(db, { appId: user.app_id, userId: user.id, action: "verify.locked" }, now);
    throw new HttpError(423, "locked", "Too many attempts. Try again later.", {
      lockedUntil,
      retryAfter: Math.ceil(lockoutMs / 1000),
    });
  }
  db.prepare("UPDATE users SET failed_attempts = ?, updated_at = ? WHERE id = ?").run(attempts, now, user.id);
  return maxFailures - attempts;
}

export function clearFailures(db: DB, userId: string, now: number): void {
  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(now, userId);
}
