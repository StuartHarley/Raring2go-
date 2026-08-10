const sensitiveKeyPattern =
  /(?:password|passphrase|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|card[_-]?number|cvv|cvc)/i;

export const redactedValue = "[REDACTED]";

export function redactSensitiveData<T>(value: T): T {
  return redact(value) as T;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = sensitiveKeyPattern.test(key)
      ? redactedValue
      : redact(nestedValue);
  }

  return redacted;
}
