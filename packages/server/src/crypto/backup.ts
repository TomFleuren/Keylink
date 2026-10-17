import { createHmac, randomBytes } from "node:crypto";
import { safeEqualString } from "./compare.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]+/g, "").toUpperCase();
}

export function generateBackupCode(): string {
  const bytes = randomBytes(10);
  let raw = "";
  for (let i = 0; i < 10; i += 1) {
    raw += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function hashBackupCode(masterKey: Buffer, code: string): string {
  return createHmac("sha256", masterKey).update(normalizeBackupCode(code)).digest("base64url");
}

/** Check every stored hash. Unused codes only. Does not stop at the first hit. */
export function matchBackupCode(
  masterKey: Buffer,
  code: string,
  rows: { id: string; code_hash: string; used_at: number | null }[],
): { id: string } | null {
  const presented = hashBackupCode(masterKey, code);
  let found: string | null = null;
  for (const row of rows) {
    const equal = safeEqualString(presented, row.code_hash);
    if (equal && row.used_at === null && found === null) found = row.id;
  }
  return found ? { id: found } : null;
}
