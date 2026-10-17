import { createHash, randomBytes } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "app";
}
