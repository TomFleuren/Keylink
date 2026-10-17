import type { DB } from "../db.js";

function prune(db: DB, since: number): void {
  db.prepare("DELETE FROM auth_attempts WHERE created_at < ?").run(since);
}

export function attemptCount(db: DB, bucket: string, windowMs: number, now = Date.now()): number {
  const since = now - windowMs;
  prune(db, since - windowMs);
  const row = db.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE bucket = ? AND created_at >= ?").get(bucket, since) as {
    n: number;
  };
  return row.n;
}

export function noteAttempt(db: DB, bucket: string, now = Date.now()): void {
  db.prepare("INSERT INTO auth_attempts (bucket, created_at) VALUES (?, ?)").run(bucket, now);
}

export function hitIpLimit(db: DB, ip: string, limit: number, windowMs: number, now = Date.now()): { limited: boolean; retryAfter: number } {
  const bucket = `ip:${ip}`;
  const count = attemptCount(db, bucket, windowMs, now);
  if (count >= limit) return { limited: true, retryAfter: Math.ceil(windowMs / 1000) };
  noteAttempt(db, bucket, now);
  return { limited: false, retryAfter: 0 };
}
