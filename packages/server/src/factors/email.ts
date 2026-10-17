import { FactorUnavailable, type FactorProvider } from "./types.js";

/**
 * Email one-time codes are reserved. The factors table has `email_ciphertext`
 * for a future provider that would:
 *   1. Store the address encrypted with the master key.
 *   2. Issue a short numeric code, store only its HMAC, and mail the plaintext.
 *   3. Rate-limit sends and verify with the same lockout path as TOTP.
 */
export const emailProvider: FactorProvider = {
  type: "email",
  implemented: false,
  summary: "Email one-time codes. Reserved; not available in this version.",
};

export function assertEmailAvailable(): never {
  throw new FactorUnavailable(
    "email",
    "Email codes are not available in this version of Keylink. Enroll a TOTP authenticator instead.",
  );
}
