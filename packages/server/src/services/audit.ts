import type { DB } from "../db.js";
import { newId } from "../ids.js";

export function audit(
  db: DB,
  event: { appId?: string | null; userId?: string | null; action: string; ip?: string | null; detail?: string | null },
  now = Date.now(),
): void {
  db.prepare(
    `INSERT INTO audit_events (id, app_id, user_id, action, ip, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId("aud"), event.appId ?? null, event.userId ?? null, event.action, event.ip ?? null, event.detail ?? null, now);
}
