export function isSafeId(value: string): boolean {
  if (!value) {
    return false;
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

