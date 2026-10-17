import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, base32Encode } from "./base32.js";
import { safeEqualString } from "./compare.js";
import { decryptSecret, deriveMasterKey, encryptSecret } from "./secret.js";
import { hotp, totpAt, verifyTotp } from "./totp.js";
import { generateBackupCode, hashBackupCode, matchBackupCode, normalizeBackupCode } from "./backup.js";

const SHA1 = Buffer.from("12345678901234567890", "ascii");
const SHA256 = Buffer.from("12345678901234567890123456789012", "ascii");
const SHA512 = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234", "ascii");

test("HOTP matches RFC 4226 appendix D", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => {
    assert.equal(hotp(SHA1, counter, 6, "sha1"), code);
  });
});

test("TOTP matches RFC 6238 appendix B", () => {
  const vectors: { time: number; sha1: string; sha256: string; sha512: string }[] = [
    { time: 59, sha1: "94287082", sha256: "46119246", sha512: "90693936" },
    { time: 1111111109, sha1: "07081804", sha256: "68084774", sha512: "25091201" },
    { time: 1111111111, sha1: "14050471", sha256: "67062674", sha512: "99943326" },
    { time: 1234567890, sha1: "89005924", sha256: "91819424", sha512: "93441116" },
    { time: 2000000000, sha1: "69279037", sha256: "90698825", sha512: "38618901" },
    { time: 20000000000, sha1: "65353130", sha256: "77737706", sha512: "47863826" },
  ];
  for (const vector of vectors) {
    const when = vector.time * 1000;
    assert.equal(totpAt(SHA1, when, { algorithm: "sha1", digits: 8, period: 30 }), vector.sha1);
    assert.equal(totpAt(SHA256, when, { algorithm: "sha256", digits: 8, period: 30 }), vector.sha256);
    assert.equal(totpAt(SHA512, when, { algorithm: "sha512", digits: 8, period: 30 }), vector.sha512);
  }
});

test("verification accepts a window and rejects a replayed step", () => {
  const now = 1_700_000_000_000;
  const params = { algorithm: "sha1" as const, digits: 6, period: 30, window: 1 };
  const code = totpAt(SHA1, now, params);
  const first = verifyTotp({ secret: SHA1, code, timeMs: now, params, lastAcceptedStep: null });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const replay = verifyTotp({ secret: SHA1, code, timeMs: now, params, lastAcceptedStep: first.step });
  assert.deepEqual(replay, { ok: false, reason: "replay" });
  assert.equal(verifyTotp({ secret: SHA1, code: "000000", timeMs: now, params, lastAcceptedStep: null }).ok, false);
});

test("base32 round-trips and groups are ignored by the decoder", () => {
  const raw = Buffer.from("keylink-secret!!", "utf8");
  const encoded = base32Encode(raw);
  assert.equal(base32Decode(encoded).equals(raw), true);
  assert.equal(base32Decode(encoded.match(/.{1,4}/g)!.join(" ")).equals(raw), true);
});

test("secret ciphertext is authenticated to a user id", () => {
  const key = deriveMasterKey("test-passphrase");
  assert.equal(key.length, 32);
  const hexKey = deriveMasterKey("ab".repeat(32));
  assert.equal(hexKey.equals(Buffer.from("ab".repeat(32), "hex")), true);
  const blob = encryptSecret(key, Buffer.from("super-secret"), "totp:user_1");
  assert.equal(blob.includes("super-secret"), false);
  assert.equal(decryptSecret(key, blob, "totp:user_1").toString(), "super-secret");
  assert.throws(() => decryptSecret(key, blob, "totp:user_2"));
});

test("backup codes match once and comparisons do not stop early", () => {
  const key = deriveMasterKey("11".repeat(32));
  const code = generateBackupCode();
  assert.match(normalizeBackupCode(code), /^[A-Z2-9]{10}$/);
  const rows = [
    { id: "a", code_hash: hashBackupCode(key, "AAAAA-BBBBB"), used_at: null },
    { id: "b", code_hash: hashBackupCode(key, code), used_at: null },
  ];
  assert.equal(matchBackupCode(key, code.toLowerCase(), rows)?.id, "b");
  rows[1]!.used_at = Date.now();
  assert.equal(matchBackupCode(key, code, rows), null);
  assert.equal(matchBackupCode(key, "ZZZZZ-ZZZZZ", rows), null);
});

test("string compare rejects different lengths", () => {
  assert.equal(safeEqualString("123456", "123456"), true);
  assert.equal(safeEqualString("123456", "123457"), false);
  assert.equal(safeEqualString("123456", "1234567"), false);
});
