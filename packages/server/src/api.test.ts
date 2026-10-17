import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { base32Decode } from "./crypto/base32.js";
import { hotp } from "./crypto/totp.js";
import type { FastifyInstance } from "fastify";
import type { DB } from "./db.js";

const ORIGIN = "http://localhost:4781";

async function boot(extra: Record<string, string> = {}): Promise<{ app: FastifyInstance; db: DB; apiKey: string }> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    KEYLINK_MASTER_KEY: "11".repeat(32),
    KEYLINK_ADMIN_PASSWORD: "test-admin-password",
    KEYLINK_SCRYPT_N: "1024",
    KEYLINK_LOG_LEVEL: "silent",
    KEYLINK_BOOTSTRAP_APP: "",
    KEYLINK_MAX_FAILURES: extra.KEYLINK_MAX_FAILURES ?? "5",
    KEYLINK_DATA_DIR: "/tmp/keylink-test-unused",
  });
  const db = new DatabaseSync(":memory:");
  const app = await buildApp({ config, db });
  const login = await app.inject({
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "password=test-admin-password",
  });
  assert.equal(login.statusCode, 302);
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const session = db.prepare("SELECT csrf FROM admin_sessions").get() as { csrf: string };
  const created = await app.inject({
    method: "POST",
    url: "/admin/apps",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ name: "Fieldnote", issuer: "Fieldnote", origins: ORIGIN, csrf: session.csrf }).toString(),
  });
  assert.equal(created.statusCode, 302);
  const appId = String(created.headers.location).split("/").pop();
  const issued = await app.inject({
    method: "POST",
    url: `/admin/apps/${appId}/keys`,
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ name: "Test", csrf: session.csrf }).toString(),
  });
  assert.equal(issued.statusCode, 302);
  const page = await app.inject({ method: "GET", url: `/admin/apps/${appId}`, headers: { cookie } });
  const match = page.body.match(/kl_live_[A-Za-z0-9_-]+/);
  assert.ok(match, "issued key should be shown once");
  const stored = db.prepare("SELECT key_hash FROM api_keys").get() as { key_hash: string };
  assert.equal(stored.key_hash.includes(match[0]), false);
  return { app, db, apiKey: match[0] };
}

function codeFor(secret: string, stepOffset = 0): string {
  const raw = base32Decode(secret);
  const step = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  return hotp(raw, step, 6, "sha1");
}

test("health and service placard", async () => {
  const { app } = await boot();
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);
  const home = await app.inject({ method: "GET", url: "/" });
  assert.match(home.body, /Keylink/);
  await app.close();
});

test("enroll, verify, replay, backup code, and lockout", async () => {
  const { app, db, apiKey } = await boot({ KEYLINK_MAX_FAILURES: "3" });
  const auth = { authorization: `Bearer ${apiKey}` };

  const missing = await app.inject({ method: "GET", url: "/v1/users/ada", headers: auth });
  assert.equal(missing.statusCode, 404);

  const session = await app.inject({
    method: "POST",
    url: "/v1/users/ada%40fieldnote.test/sessions",
    headers: { ...auth, "content-type": "application/json" },
    payload: { purpose: "enroll", displayName: "Ada Lovelace" },
  });
  assert.equal(session.statusCode, 200);
  const created = session.json();
  assert.equal(created.purpose, "enroll");
  assert.match(created.totp.otpauthUrl, /^otpauth:\/\/totp\//);
  const storedSecret = db.prepare("SELECT secret_ciphertext FROM factors").get() as { secret_ciphertext: string };
  assert.equal(storedSecret.secret_ciphertext.includes(created.totp.secret), false);

  const badOrigin = await app.inject({
    method: "GET",
    url: "/v1/widget/session",
    headers: { authorization: `Bearer ${created.clientToken}`, origin: "http://evil.test" },
  });
  assert.equal(badOrigin.statusCode, 403);

  const widget = await app.inject({
    method: "GET",
    url: "/v1/widget/session",
    headers: { authorization: `Bearer ${created.clientToken}`, origin: ORIGIN },
  });
  assert.equal(widget.statusCode, 200);
  assert.equal(widget.headers["access-control-allow-origin"], ORIGIN);
  assert.match(widget.json().totp.qrSvg, /<svg/);

  const confirm = await app.inject({
    method: "POST",
    url: "/v1/widget/confirm",
    headers: { authorization: `Bearer ${created.clientToken}`, origin: ORIGIN, "content-type": "application/json" },
    payload: { code: codeFor(created.totp.secret, 0) },
  });
  assert.equal(confirm.statusCode, 200, confirm.body);
  assert.equal(confirm.json().backupCodes.length, 8);
  const backup = confirm.json().backupCodes[0] as string;
  const consumed = await app.inject({
    method: "POST",
    url: `/v1/sessions/${created.sessionId}/consume`,
    headers: auth,
  });
  assert.equal(consumed.statusCode, 200, consumed.body);
  assert.equal(consumed.json().status, "succeeded");
  const consumedAgain = await app.inject({
    method: "POST",
    url: `/v1/sessions/${created.sessionId}/consume`,
    headers: auth,
  });
  assert.equal(consumedAgain.statusCode, 409);

  const replay = await app.inject({
    method: "POST",
    url: "/v1/users/ada%40fieldnote.test/verify",
    headers: { ...auth, "content-type": "application/json" },
    payload: { code: codeFor(created.totp.secret, 0) },
  });
  assert.equal(replay.statusCode, 401);

  const ok = await app.inject({
    method: "POST",
    url: "/v1/users/ada%40fieldnote.test/verify",
    headers: { ...auth, "content-type": "application/json" },
    payload: { code: codeFor(created.totp.secret, 1) },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().factor, "totp");

  const again = await app.inject({
    method: "POST",
    url: "/v1/users/ada%40fieldnote.test/verify",
    headers: { ...auth, "content-type": "application/json" },
    payload: { code: codeFor(created.totp.secret, 1) },
  });
  assert.equal(again.statusCode, 401);

  const withBackup = await app.inject({
    method: "POST",
    url: "/v1/users/ada%40fieldnote.test/verify",
    headers: { ...auth, "content-type": "application/json" },
    payload: { code: backup },
  });
  assert.equal(withBackup.statusCode, 200, withBackup.body);
  assert.equal(withBackup.json().factor, "backup_code");
  const spent = await app.inject({
    method: "POST",
    url: "/v1/users/ada%40fieldnote.test/verify",
    headers: { ...auth, "content-type": "application/json" },
    payload: { code: backup },
  });
  assert.equal(spent.statusCode, 401);

  const status = await app.inject({ method: "GET", url: "/v1/users/ada%40fieldnote.test", headers: auth });
  assert.equal(status.json().enrolled, true);
  assert.equal(status.json().backupCodesRemaining, 7);

  const factors = await app.inject({ method: "GET", url: "/v1/factors", headers: auth });
  assert.equal(factors.json().factors.find((factor: { type: string }) => factor.type === "webauthn").implemented, false);
  const passkey = await app.inject({ method: "POST", url: "/v1/users/ada%40fieldnote.test/webauthn/register", headers: auth });
  assert.equal(passkey.statusCode, 501);
  const email = await app.inject({ method: "POST", url: "/v1/users/ada%40fieldnote.test/email/challenge", headers: auth });
  assert.equal(email.statusCode, 501);

  await app.close();
});

test("lockout after repeated failures and admin unlock", async () => {
  const { app, db, apiKey } = await boot({ KEYLINK_MAX_FAILURES: "3" });
  const auth = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  const session = await app.inject({
    method: "POST",
    url: "/v1/users/bea/sessions",
    headers: auth,
    payload: { purpose: "enroll", displayName: "Bea" },
  });
  const secret = session.json().totp.secret as string;
  const confirm = await app.inject({
    method: "POST",
    url: "/v1/widget/confirm",
    headers: { authorization: `Bearer ${session.json().clientToken}`, "content-type": "application/json" },
    payload: { code: codeFor(secret, 0) },
  });
  assert.equal(confirm.statusCode, 200, confirm.body);

  for (let i = 0; i < 2; i += 1) {
    const fail = await app.inject({
      method: "POST",
      url: "/v1/users/bea/verify",
      headers: auth,
      payload: { code: "000000" },
    });
    assert.equal(fail.statusCode, 401);
  }
  const locked = await app.inject({
    method: "POST",
    url: "/v1/users/bea/verify",
    headers: auth,
    payload: { code: "000000" },
  });
  assert.equal(locked.statusCode, 423);

  const login = await app.inject({
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "password=test-admin-password",
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const page = await app.inject({ method: "GET", url: "/admin", headers: { cookie } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Fieldnote/);
  const csrf = (
    db.prepare("SELECT csrf FROM admin_sessions ORDER BY created_at DESC LIMIT 1").get() as { csrf: string }
  ).csrf;
  const user = await app.inject({ method: "GET", url: "/v1/users/bea", headers: { authorization: `Bearer ${apiKey}` } });
  const unlock = await app.inject({
    method: "POST",
    url: `/admin/users/${user.json().id}/unlock`,
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ csrf }).toString(),
  });
  assert.equal(unlock.statusCode, 302);
  const after = await app.inject({
    method: "POST",
    url: "/v1/users/bea/verify",
    headers: auth,
    payload: { code: codeFor(secret, 1) },
  });
  assert.equal(after.statusCode, 200, after.body);
  await app.close();
});

test("rejects a missing API key and a bad admin password", async () => {
  const { app } = await boot();
  const denied = await app.inject({ method: "GET", url: "/v1/users/ada" });
  assert.equal(denied.statusCode, 401);
  const login = await app.inject({
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "password=nope",
  });
  assert.equal(login.statusCode, 401);
  assert.match(login.body, /not accepted/);
  await app.close();
});
