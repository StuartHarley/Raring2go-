/** Fail the job straight to the dead-letter state: retrying cannot help. */
export class PermanentJobError extends Error {
  readonly code: string;

  constructor(message: string, code = "permanent") {
    super(message);
    this.name = "PermanentJobError";
    this.code = code;
  }
}

/** Retryable failure that may carry a provider-suggested delay (e.g. Retry-After). */
export class RetryableJobError extends Error {
  readonly code: string;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { code?: string; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "RetryableJobError";
    this.code = options.code ?? "retryable";
    this.retryAfterMs = options.retryAfterMs;
  }
}
