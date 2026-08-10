export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

export type RateLimiter = {
  check(key: string): Promise<RateLimitDecision>;
};

export function createDevelopmentMemoryRateLimiter(input: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    async check(key) {
      const now = Date.now();
      const existing = buckets.get(key);
      const bucket =
        existing && existing.resetAt > now
          ? existing
          : {
              count: 0,
              resetAt: now + input.windowMs
            };

      bucket.count += 1;
      buckets.set(key, bucket);

      return {
        allowed: bucket.count <= input.limit,
        remaining: Math.max(input.limit - bucket.count, 0),
        resetAt: new Date(bucket.resetAt)
      };
    }
  };
}
