export function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new Error("A valid email address is required.");
  }

  return normalized;
}
