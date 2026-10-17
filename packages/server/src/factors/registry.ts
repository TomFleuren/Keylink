import { emailProvider } from "./email.js";
import type { FactorProvider, FactorType } from "./types.js";
import { webauthnProvider } from "./webauthn.js";

export const totpProvider: FactorProvider = {
  type: "totp",
  implemented: true,
  summary: "Authenticator-app codes (RFC 6238), compatible with Google Authenticator, Authy, and 1Password.",
};

export const backupProvider: FactorProvider = {
  type: "backup_code",
  implemented: true,
  summary: "Single-use recovery codes generated when an authenticator is enrolled.",
};

const providers: Record<FactorType, FactorProvider> = {
  totp: totpProvider,
  backup_code: backupProvider,
  webauthn: webauthnProvider,
  email: emailProvider,
};

export function listFactors(): FactorProvider[] {
  return Object.values(providers);
}

export function getFactor(type: string): FactorProvider | undefined {
  return providers[type as FactorType];
}
