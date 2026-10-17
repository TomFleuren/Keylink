export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function normalizeBackup(value: string): string {
  return value.replace(/[^0-9a-z]/gi, "").toUpperCase();
}
