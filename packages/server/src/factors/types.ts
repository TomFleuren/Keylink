/**
 * A factor is one way a user proves a second factor.
 * TOTP ships in v1. WebAuthn and email are registered so callers, storage,
 * and routes already have a place for them. See factors/webauthn.ts.
 */
export type FactorType = "totp" | "backup_code" | "webauthn" | "email";

export class FactorUnavailable extends Error {
  readonly factor: FactorType;

  constructor(factor: FactorType, message: string) {
    super(message);
    this.name = "FactorUnavailable";
    this.factor = factor;
  }
}

export type FactorProvider = {
  type: FactorType;
  /** False for factors that are reserved extension points. */
  implemented: boolean;
  summary: string;
};
