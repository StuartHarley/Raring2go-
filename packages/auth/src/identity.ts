import { normalizeEmail } from "./email";
import type { AuthRepository } from "./types";

export async function findOrCreateUserByEmail(
  repository: AuthRepository,
  input: {
    email: string;
    displayName?: string;
  }
) {
  const email = normalizeEmail(input.email);
  const existing = await repository.findUserByEmail(email);

  if (existing) {
    return existing;
  }

  return repository.createUser({
    email,
    displayName: input.displayName
  });
}
