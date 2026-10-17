import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION = "v1";

export function deriveMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return scryptSync(trimmed, "keylink.master.v1", 32);
}

/**
 * AES-256-GCM. The additional data (usually the user id) is authenticated,
 * so a ciphertext cannot be moved onto a different row and still decrypt.
 */
export function encryptSecret(masterKey: Buffer, plaintext: Buffer, aad: string): string {
  if (masterKey.length !== 32) {
    throw new Error("Master key must be 32 bytes");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(masterKey: Buffer, encoded: string, aad: string): Buffer {
  const [version, ivPart, tagPart, ctPart] = encoded.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !ctPart) {
    throw new Error("Unrecognized secret encoding");
  }
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(ivPart, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctPart, "base64url")), decipher.final()]);
}
