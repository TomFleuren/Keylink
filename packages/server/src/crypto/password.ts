import { randomBytes, scryptSync } from "node:crypto";
import { safeEqualBuffer } from "./compare.js";

const SALT = "keylink.admin.v1";

export function hashAdminPassword(password: string, n: number): Buffer {
  return scryptSync(password, SALT, 32, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function checkAdminPassword(password: string, expected: Buffer, n: number): boolean {
  const got = hashAdminPassword(password, n);
  return safeEqualBuffer(got, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
