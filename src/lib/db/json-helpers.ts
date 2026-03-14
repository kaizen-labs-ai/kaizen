export function parseJsonField<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJsonString(value: unknown): string {
  return JSON.stringify(value);
}
