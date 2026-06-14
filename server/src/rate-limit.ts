export interface PublishRateLimitResult {
  allowed: boolean;
  identityId: string;
  limit: number;
  count: number;
  resetMs: number;
}

const counters = new Map<string, { count: number; resetAt: number }>();

export function checkPublishRateLimit(
  identityId: string,
  opts: { max?: number; windowMs?: number } = {},
): PublishRateLimitResult {
  const limit = Math.max(0, opts.max ?? Number(process.env.PUBLISH_RATE_LIMIT_MAX ?? "120"));
  const windowMs = Math.max(
    1_000,
    opts.windowMs ?? Number(process.env.PUBLISH_RATE_LIMIT_WINDOW_MS ?? "60000"),
  );
  if (limit <= 0) {
    return { allowed: true, identityId, limit, count: 0, resetMs: 0 };
  }

  const bucket = Math.floor(Date.now() / windowMs);
  const key = `${identityId}:${bucket}`;
  const resetAt = (bucket + 1) * windowMs;
  const count = (counters.get(key)?.count ?? 0) + 1;
  counters.set(key, { count, resetAt });

  for (const [entryKey, entry] of counters) {
    if (entry.resetAt <= Date.now()) counters.delete(entryKey);
  }

  return {
    allowed: count <= limit,
    identityId,
    limit,
    count,
    resetMs: Math.max(0, resetAt - Date.now()),
  };
}

export function clearPublishRateLimitForTests(): void {
  counters.clear();
}
