import path from "node:path";
import { deriveMasterKey } from "./crypto/secret.js";

export type Config = {
  port: number;
  host: string;
  dataDir: string;
  databasePath: string;
  masterKey: Buffer;
  adminPassword: string;
  publicUrl: string;
  totpWindow: number;
  maxFailures: number;
  lockoutMs: number;
  sessionTtlMs: number;
  adminTtlMs: number;
  bootstrapApp: string | null;
  bootstrapOrigins: string[];
  logLevel: string;
  scryptN: number;
  usingDevSecrets: boolean;
  ipRateLimit: number;
  ipRateWindowMs: number;
};

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received ${value}`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const masterRaw = env.KEYLINK_MASTER_KEY?.trim();
  const adminPassword = env.KEYLINK_ADMIN_PASSWORD;
  if (production && !masterRaw) {
    throw new Error("KEYLINK_MASTER_KEY is required when NODE_ENV=production");
  }
  if (production && !adminPassword) {
    throw new Error("KEYLINK_ADMIN_PASSWORD is required when NODE_ENV=production");
  }
  const port = num(env.KEYLINK_PORT, 4780);
  const dataDir = path.resolve(env.KEYLINK_DATA_DIR ?? path.join(process.cwd(), "data"));
  const databasePath =
    env.KEYLINK_DATABASE === ":memory:"
      ? ":memory:"
      : path.resolve(env.KEYLINK_DATABASE ?? path.join(dataDir, "keylink.sqlite"));
  return {
    port,
    host: env.KEYLINK_HOST ?? "0.0.0.0",
    dataDir,
    databasePath,
    masterKey: deriveMasterKey(masterRaw || "dev-only-master-key-not-for-production"),
    adminPassword: adminPassword || "dev-admin-password",
    publicUrl: (env.KEYLINK_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    totpWindow: num(env.KEYLINK_TOTP_WINDOW, 1),
    maxFailures: num(env.KEYLINK_MAX_FAILURES, 5),
    lockoutMs: num(env.KEYLINK_LOCKOUT_MS, 15 * 60 * 1000),
    sessionTtlMs: num(env.KEYLINK_SESSION_TTL_MS, 10 * 60 * 1000),
    adminTtlMs: num(env.KEYLINK_ADMIN_TTL_MS, 12 * 60 * 60 * 1000),
    bootstrapApp: env.KEYLINK_BOOTSTRAP_APP?.trim() || null,
    bootstrapOrigins: (env.KEYLINK_BOOTSTRAP_ORIGINS ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    logLevel: env.KEYLINK_LOG_LEVEL ?? (production ? "info" : "info"),
    scryptN: num(env.KEYLINK_SCRYPT_N, 16384),
    usingDevSecrets: !masterRaw || !adminPassword,
    ipRateLimit: num(env.KEYLINK_IP_RATE_LIMIT, 60),
    ipRateWindowMs: num(env.KEYLINK_IP_RATE_WINDOW_MS, 5 * 60 * 1000),
  };
}
