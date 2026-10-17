export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge?: number; clear?: boolean; secure?: boolean } = {},
): string {
  const bits = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.secure) bits.push("Secure");
  if (options.clear) bits.push("Max-Age=0");
  else if (options.maxAge) bits.push(`Max-Age=${options.maxAge}`);
  return bits.join("; ");
}

export function themeCookie(theme: string, secure = false): string {
  const secureBit = secure ? "; Secure" : "";
  return `kl_theme=${encodeURIComponent(theme)}; Path=/; Max-Age=31536000; SameSite=Lax${secureBit}`;
}
