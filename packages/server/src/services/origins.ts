export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  return url.origin;
}

export function parseOriginList(text: string): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const line of text.split(/[\n,]/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const origin = normalizeOrigin(trimmed);
    if (!origin) invalid.push(trimmed);
    else if (!origins.includes(origin)) origins.push(origin);
  }
  return { origins, invalid };
}

export function parseStoredOrigins(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
