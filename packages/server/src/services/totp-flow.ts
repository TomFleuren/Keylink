import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { generateBackupCode, hashBackupCode, matchBackupCode, normalizeBackupCode } from "../crypto/backup.js";
import { base32Encode, groupSecret } from "../crypto/base32.js";
import { decryptSecret, encryptSecret } from "../crypto/secret.js";
import { buildOtpauthUrl, DEFAULT_TOTP, totpAt, verifyTotp, type TotpAlgorithm } from "../crypto/totp.js";
import type { Config } from "../config.js";
import type { DB } from "../db.js";
import { newId, newToken, sha256 } from "../ids.js";
import { HttpError } from "../http/errors.js";
import { audit } from "./audit.js";
import type { AppRow } from "./apps.js";
import {
  activeTotp,
  assertNotLocked,
  clearFailures,
  recordFailure,
  type FactorRow,
  type UserRow,
} from "./users.js";

export type ClientSessionRow = {
  id: string;
  app_id: string;
  user_id: string;
  purpose: string;
  token_hash: string;
  status: string;
  expires_at: number;
  created_at: number;
  completed_at: number | null;
  consumed_at: number | null;
};

type BackupRow = { id: string; user_id: string; code_hash: string; created_at: number; used_at: number | null };

function totpParams(config: Config, factor?: FactorRow) {
  return {
    algorithm: (factor?.algorithm as TotpAlgorithm | null) ?? DEFAULT_TOTP.algorithm,
    digits: factor?.digits ?? DEFAULT_TOTP.digits,
    period: factor?.period ?? DEFAULT_TOTP.period,
    window: config.totpWindow,
  };
}

async function qrSvg(otpauthUrl: string): Promise<string> {
  const svg = await QRCode.toString(otpauthUrl, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1c1915", light: "#ffffff" },
  });
  return svg.replace(/<\?xml[^>]*>/, "").trim();
}

function accountLabel(user: UserRow): string {
  return user.display_name || user.external_id;
}

export async function beginEnrollment(db: DB, config: Config, app: AppRow, user: UserRow, now = Date.now()) {
  if (activeTotp(db, user.id)) {
    throw new HttpError(409, "already_enrolled", "This user already has an authenticator. Disable it before enrolling again.");
  }
  const secret = randomBytes(20);
  const params = totpParams(config);
  const ciphertext = encryptSecret(config.masterKey, secret, `totp:${user.id}`);
  const existing = db.prepare("SELECT * FROM factors WHERE user_id = ? AND type = 'totp'").get(user.id) as FactorRow | undefined;
  if (existing) {
    db.prepare(
      `UPDATE factors
       SET status = 'pending', secret_ciphertext = ?, algorithm = ?, digits = ?, period = ?,
           last_accepted_step = NULL, confirmed_at = NULL, created_at = ?
       WHERE id = ?`,
    ).run(ciphertext, params.algorithm, params.digits, params.period, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO factors (
         id, user_id, type, status, created_at, confirmed_at, secret_ciphertext, algorithm, digits, period, last_accepted_step
       ) VALUES (?, ?, 'totp', 'pending', ?, NULL, ?, ?, ?, ?, NULL)`,
    ).run(newId("fac"), user.id, now, ciphertext, params.algorithm, params.digits, params.period);
  }
  const session = insertSession(db, app.id, user.id, "enroll", now, config.sessionTtlMs);
  const otpauth = buildOtpauthUrl({
    issuer: app.issuer,
    account: accountLabel(user),
    secret,
    algorithm: params.algorithm,
    digits: params.digits,
    period: params.period,
  });
  audit(db, { appId: app.id, userId: user.id, action: "totp.enroll_started" }, now);
  return {
    sessionId: session.id,
    clientToken: session.token,
    expiresAt: session.expiresAt,
    purpose: "enroll" as const,
    totp: {
      secret: base32Encode(secret),
      secretGrouped: groupSecret(base32Encode(secret)),
      otpauthUrl: otpauth,
      qrSvg: await qrSvg(otpauth),
      digits: params.digits,
      period: params.period,
      algorithm: params.algorithm,
    },
  };
}

export function beginVerify(db: DB, config: Config, app: AppRow, user: UserRow, now = Date.now()) {
  if (!activeTotp(db, user.id)) {
    throw new HttpError(409, "not_enrolled", "This user does not have an authenticator yet.");
  }
  assertNotLocked(user, now);
  const session = insertSession(db, app.id, user.id, "verify", now, config.sessionTtlMs);
  return {
    sessionId: session.id,
    clientToken: session.token,
    expiresAt: session.expiresAt,
    purpose: "verify" as const,
  };
}

function insertSession(db: DB, appId: string, userId: string, purpose: "enroll" | "verify", now: number, ttl: number) {
  const id = newId("ses");
  const token = newToken("kls");
  const expiresAt = now + ttl;
  db.prepare(
    `INSERT INTO client_sessions (
       id, app_id, user_id, purpose, token_hash, status, expires_at, created_at, completed_at, consumed_at
     ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)`,
  ).run(id, appId, userId, purpose, sha256(token), expiresAt, now);
  return { id, token, expiresAt };
}

export function readSession(db: DB, sessionId: string, now = Date.now()): ClientSessionRow {
  const row = db.prepare("SELECT * FROM client_sessions WHERE id = ?").get(sessionId) as ClientSessionRow | undefined;
  if (!row) throw new HttpError(404, "not_found", "Session not found.");
  if (row.status === "pending" && row.expires_at <= now) {
    db.prepare("UPDATE client_sessions SET status = 'expired' WHERE id = ?").run(row.id);
    row.status = "expired";
  }
  return row;
}

export function sessionView(db: DB, sessionId: string, now = Date.now()) {
  const row = readSession(db, sessionId, now);
  const user = db.prepare("SELECT external_id FROM users WHERE id = ?").get(row.user_id) as { external_id: string };
  return {
    sessionId: row.id,
    purpose: row.purpose,
    status: row.status,
    externalId: user.external_id,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export function consumeSession(db: DB, app: AppRow, sessionId: string, now = Date.now()) {
  const row = readSession(db, sessionId, now);
  if (row.app_id !== app.id) throw new HttpError(404, "not_found", "Session not found.");
  if (row.consumed_at) throw new HttpError(409, "already_consumed", "This session was already used.");
  if (row.status !== "succeeded") {
    throw new HttpError(409, "not_verified", "This session has not been verified.");
  }
  db.prepare("UPDATE client_sessions SET consumed_at = ? WHERE id = ?").run(now, row.id);
  audit(db, { appId: app.id, userId: row.user_id, action: "session.consumed", detail: row.purpose }, now);
  return sessionView(db, sessionId, now);
}

export function sessionFromToken(db: DB, token: string, now = Date.now()): ClientSessionRow {
  if (!token.startsWith("kls_")) throw new HttpError(401, "unauthorized", "Session token is not valid.");
  const row = db.prepare("SELECT * FROM client_sessions WHERE token_hash = ?").get(sha256(token)) as
    | ClientSessionRow
    | undefined;
  if (!row) throw new HttpError(401, "unauthorized", "Session token is not valid.");
  if (row.status === "pending" && row.expires_at <= now) {
    db.prepare("UPDATE client_sessions SET status = 'expired' WHERE id = ?").run(row.id);
    throw new HttpError(401, "session_expired", "This session has expired. Start again from your site.");
  }
  if (row.status === "expired") {
    throw new HttpError(401, "session_expired", "This session has expired. Start again from your site.");
  }
  return row;
}

export async function widgetPayload(db: DB, config: Config, session: ClientSessionRow) {
  const app = db.prepare("SELECT * FROM apps WHERE id = ?").get(session.app_id) as AppRow;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as UserRow;
  const base = {
    sessionId: session.id,
    purpose: session.purpose,
    status: session.status,
    appName: app.name,
    issuer: app.issuer,
    account: accountLabel(user),
    expiresAt: session.expires_at,
  };
  if (session.purpose !== "enroll" || session.status !== "pending") return base;
  const factor = db.prepare("SELECT * FROM factors WHERE user_id = ? AND type = 'totp' AND status = 'pending'").get(user.id) as
    | FactorRow
    | undefined;
  if (!factor?.secret_ciphertext) return base;
  const secret = decryptSecret(config.masterKey, factor.secret_ciphertext, `totp:${user.id}`);
  const params = totpParams(config, factor);
  const otpauth = buildOtpauthUrl({
    issuer: app.issuer,
    account: accountLabel(user),
    secret,
    algorithm: params.algorithm,
    digits: params.digits,
    period: params.period,
  });
  return {
    ...base,
    totp: {
      secret: base32Encode(secret),
      secretGrouped: groupSecret(base32Encode(secret)),
      otpauthUrl: otpauth,
      qrSvg: await qrSvg(otpauth),
      digits: params.digits,
      period: params.period,
    },
  };
}

export async function confirmSession(
  db: DB,
  config: Config,
  session: ClientSessionRow,
  code: string,
  ip: string | null,
  now = Date.now(),
): Promise<{ ok: true; purpose: string; sessionId: string; factor: string; backupCodes?: string[] }> {
  if (session.status === "succeeded") {
    return { ok: true, purpose: session.purpose, sessionId: session.id, factor: "totp" };
  }
  if (session.status !== "pending") {
    throw new HttpError(409, "session_closed", "This session is no longer active.");
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) as UserRow;
  if (session.purpose === "enroll") {
    const backupCodes = confirmEnrollment(db, config, user, code, ip, now);
    db.prepare("UPDATE client_sessions SET status = 'succeeded', completed_at = ? WHERE id = ?").run(now, session.id);
    return { ok: true, purpose: "enroll", sessionId: session.id, factor: "totp", backupCodes };
  }
  const factor = verifyUserCode(db, config, user, code, ip, now);
  db.prepare("UPDATE client_sessions SET status = 'succeeded', completed_at = ? WHERE id = ?").run(now, session.id);
  return { ok: true, purpose: "verify", sessionId: session.id, factor };
}

export function verifyUserCode(db: DB, config: Config, user: UserRow, code: string, ip: string | null, now = Date.now()): "totp" | "backup_code" {
  assertNotLocked(user, now);
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 40) {
    throw new HttpError(400, "invalid_code", "Enter the code from your authenticator.");
  }
  const factor = activeTotp(db, user.id);
  const normalized = trimmed.replace(/\s+/g, "");
  const digits = factor?.digits ?? 6;
  const isTotpShape = /^\d+$/.test(normalized) && normalized.length === digits;
  const isBackupShape = normalizeBackupCode(trimmed).length >= 8;

  if (!factor && !isBackupShape) {
    throw new HttpError(409, "not_enrolled", "This user does not have an authenticator yet.");
  }

  if (isTotpShape && factor?.secret_ciphertext) {
    const secret = decryptSecret(config.masterKey, factor.secret_ciphertext, `totp:${user.id}`);
    const result = verifyTotp({
      secret,
      code: normalized,
      timeMs: now,
      params: totpParams(config, factor),
      lastAcceptedStep: factor.last_accepted_step,
    });
    if (result.ok) {
      db.prepare("UPDATE factors SET last_accepted_step = ? WHERE id = ?").run(result.step, factor.id);
      clearFailures(db, user.id, now);
      audit(db, { appId: user.app_id, userId: user.id, action: "verify.success", ip, detail: "totp" }, now);
      return "totp";
    }
    audit(db, {
      appId: user.app_id,
      userId: user.id,
      action: result.reason === "replay" ? "verify.replay" : "verify.failure",
      ip,
      detail: "totp",
    }, now);
    const remaining = recordFailure(db, user, config.maxFailures, config.lockoutMs, now);
    throw new HttpError(401, "invalid_code", "That code was not accepted.", { remainingAttempts: remaining });
  }

  if (isBackupShape) {
    const rows = db.prepare("SELECT * FROM backup_codes WHERE user_id = ?").all(user.id) as unknown as BackupRow[];
    const match = matchBackupCode(config.masterKey, trimmed, rows);
    if (match) {
      db.prepare("UPDATE backup_codes SET used_at = ? WHERE id = ?").run(now, match.id);
      clearFailures(db, user.id, now);
      audit(db, { appId: user.app_id, userId: user.id, action: "verify.success", ip, detail: "backup_code" }, now);
      return "backup_code";
    }
  }

  audit(db, { appId: user.app_id, userId: user.id, action: "verify.failure", ip, detail: "backup_code" }, now);
  const remaining = recordFailure(db, user, config.maxFailures, config.lockoutMs, now);
  throw new HttpError(401, "invalid_code", "That code was not accepted.", { remainingAttempts: remaining });
}

function confirmEnrollment(db: DB, config: Config, user: UserRow, code: string, ip: string | null, now: number): string[] {
  assertNotLocked(user, now);
  const factor = db.prepare("SELECT * FROM factors WHERE user_id = ? AND type = 'totp' AND status = 'pending'").get(user.id) as
    | FactorRow
    | undefined;
  if (!factor?.secret_ciphertext) {
    throw new HttpError(409, "not_pending", "There is no authenticator enrollment in progress.");
  }
  const secret = decryptSecret(config.masterKey, factor.secret_ciphertext, `totp:${user.id}`);
  const normalized = code.trim().replace(/\s+/g, "");
  const result = verifyTotp({
    secret,
    code: normalized,
    timeMs: now,
    params: totpParams(config, factor),
    lastAcceptedStep: null,
  });
  if (!result.ok) {
    audit(db, { appId: user.app_id, userId: user.id, action: "totp.enroll_failed", ip }, now);
    const remaining = recordFailure(db, user, config.maxFailures, config.lockoutMs, now);
    throw new HttpError(401, "invalid_code", "That code was not accepted.", { remainingAttempts: remaining });
  }
  db.prepare("UPDATE factors SET status = 'active', confirmed_at = ?, last_accepted_step = ? WHERE id = ?").run(
    now,
    result.step,
    factor.id,
  );
  const codes = replaceBackupCodes(db, config, user.id, now);
  clearFailures(db, user.id, now);
  audit(db, { appId: user.app_id, userId: user.id, action: "totp.enrolled", ip }, now);
  return codes;
}

function replaceBackupCodes(db: DB, config: Config, userId: string, now: number): string[] {
  db.prepare("DELETE FROM backup_codes WHERE user_id = ?").run(userId);
  const codes: string[] = [];
  const insert = db.prepare("INSERT INTO backup_codes (id, user_id, code_hash, created_at, used_at) VALUES (?, ?, ?, ?, NULL)");
  for (let i = 0; i < 8; i += 1) {
    const code = generateBackupCode();
    codes.push(code);
    insert.run(newId("bak"), userId, hashBackupCode(config.masterKey, code), now);
  }
  return codes;
}

export function regenerateBackupCodes(db: DB, config: Config, user: UserRow, now = Date.now()): string[] {
  if (!activeTotp(db, user.id)) {
    throw new HttpError(409, "not_enrolled", "Enroll an authenticator before issuing backup codes.");
  }
  const codes = replaceBackupCodes(db, config, user.id, now);
  audit(db, { appId: user.app_id, userId: user.id, action: "backup_codes.regenerated" }, now);
  return codes;
}

export function disableTotp(db: DB, user: UserRow, now = Date.now()): void {
  db.prepare("DELETE FROM factors WHERE user_id = ? AND type = 'totp'").run(user.id);
  db.prepare("DELETE FROM backup_codes WHERE user_id = ?").run(user.id);
  audit(db, { appId: user.app_id, userId: user.id, action: "totp.disabled" }, now);
}

export function currentTotpCode(secret: Buffer, now = Date.now()): string {
  return totpAt(secret, now, DEFAULT_TOTP);
}
