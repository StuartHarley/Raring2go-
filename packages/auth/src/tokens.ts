import { createHash } from "node:crypto";

export function hashToken(token: string) {
  if (!token) {
    throw new Error("Token is required.");
  }

  return createHash("sha256").update(token).digest("hex");
}
