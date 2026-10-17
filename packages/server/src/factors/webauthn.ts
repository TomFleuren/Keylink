import { FactorUnavailable, type FactorProvider } from "./types.js";

/**
 * Passkeys / WebAuthn are intentionally not implemented in v1.
 *
 * The `factors` table already has `credential_id`, `public_key`, `sign_count`,
 * and `transports`. A future provider should:
 *   1. Create a challenge row bound to the user and a short TTL.
 *   2. Return PublicKeyCredentialCreationOptions / RequestOptions to the widget.
 *   3. Verify the attestation or assertion with a maintained WebAuthn library.
 *   4. Store the credential public key and increment sign_count (clone detection).
 *
 * Routes under /v1/factors/webauthn return 501 until that work lands.
 */
export const webauthnProvider: FactorProvider = {
  type: "webauthn",
  implemented: false,
  summary: "Passkeys via WebAuthn. Reserved; not available in this version.",
};

export function assertWebauthnAvailable(): never {
  throw new FactorUnavailable(
    "webauthn",
    "Passkeys are not available in this version of Keylink. Enroll a TOTP authenticator instead.",
  );
}
