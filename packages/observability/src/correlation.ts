import { randomUUID } from "node:crypto";

export const correlationHeader = "x-correlation-id";

// Accept ids from callers (so one request can be followed across services) but only
// well-formed ones: the value ends up in logs and audit rows.
const acceptable = /^[A-Za-z0-9._:-]{8,128}$/;

export function newCorrelationId() {
  return randomUUID();
}

export function correlationIdFrom(headers: { get(name: string): string | null }) {
  const supplied = headers.get(correlationHeader);
  return supplied && acceptable.test(supplied) ? supplied : newCorrelationId();
}
