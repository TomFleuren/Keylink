import { createHmac } from "node:crypto";
import { base32Encode } from "./base32.js";
import { safeEqualString } from "./compare.js";

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

export type TotpParams = {
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  window: number;
};

export const DEFAULT_TOTP: TotpParams = {
  algorithm: "sha1",
  digits: 6,
  period: 30,
  window: 1,
};

export function hotp(secret: Buffer, counter: number, digits: number, algorithm: TotpAlgorithm): string {
  if (digits < 6 || digits > 8) {
    throw new Error("TOTP digits must be 6, 7, or 8");
  }
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm, secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, "0");
}

export function totpAt(secret: Buffer, timeMs: number, params: Pick<TotpParams, "algorithm" | "digits" | "period">): string {
  const step = Math.floor(timeMs / 1000 / params.period);
  return hotp(secret, step, params.digits, params.algorithm);
}

export type TotpCheck =
  | { ok: true; step: number }
  | { ok: false; reason: "mismatch" | "replay" };

/**
 * Accept a code in a small window around the current step.
 * Every candidate is compared in constant time. A step at or before
 * `lastAcceptedStep` is a replay even when the code matches.
 */
export function verifyTotp(options: {
  secret: Buffer;
  code: string;
  timeMs: number;
  params: TotpParams;
  lastAcceptedStep: number | null;
}): TotpCheck {
  const { secret, code, timeMs, params, lastAcceptedStep } = options;
  const normalized = code.replace(/\s+/g, "");
  const current = Math.floor(timeMs / 1000 / params.period);
  let matched = -1;
  for (let offset = -params.window; offset <= params.window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = hotp(secret, step, params.digits, params.algorithm);
    const equal = safeEqualString(normalized, expected);
    if (equal && matched < 0) matched = step;
  }
  if (matched < 0) return { ok: false, reason: "mismatch" };
  if (lastAcceptedStep !== null && matched <= lastAcceptedStep) {
    return { ok: false, reason: "replay" };
  }
  return { ok: true, step: matched };
}

export function buildOtpauthUrl(options: {
  issuer: string;
  account: string;
  secret: Buffer;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}): string {
  const secret = base32Encode(options.secret);
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;
  const params = new URLSearchParams({
    secret,
    issuer: options.issuer,
    algorithm: options.algorithm.toUpperCase(),
    digits: String(options.digits),
    period: String(options.period),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
