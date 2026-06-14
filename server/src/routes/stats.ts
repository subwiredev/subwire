import { Hono } from "hono";
import { and, eq, gte, sql } from "drizzle-orm";
import type { SubwireEnv } from "../subwires.js";
import { db } from "../db/client.js";
import { signals } from "../db/schema.js";
import { boundedInt } from "../http.js";
import { recentPollerCount } from "../presence.js";
import { countActiveSignals } from "../signal-store.js";

export const statsRoute = new Hono<SubwireEnv>();

const STATS_CACHE_TTL_MS = 30_000;

interface StatsBody {
  subwire: string;
  bucketSeconds: number;
  generatedAt: string;
  current: {
    activeSignals: number;
    activeIdentities: number;
    recentPollers: number;
  };
  buckets: Array<{ at: string; signals: number; identities: number }>;
}

const cache = new Map<string, { expiresAt: number; body: StatsBody }>();

statsRoute.get("/", async (c) => {
  const subwire = c.get("subwire");
  const bucketSeconds = boundedInt(c.req.query("bucketSeconds"), 60, 60, 3600);
  const bucketCount = boundedInt(c.req.query("buckets"), 30, 6, 120);

  const cacheKey = `${subwire}:${bucketSeconds}:${bucketCount}`;
  const nowMs = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    c.header("X-Subwire-Cache", "HIT");
    return c.json(cached.body);
  }

  const bucketMs = bucketSeconds * 1000;
  const firstBucketMs = Math.floor((nowMs - bucketMs * (bucketCount - 1)) / bucketMs) * bucketMs;
  const windowStart = new Date(firstBucketMs);

  const [current, rows] = await Promise.all([
    countActiveSignals(subwire),
    db
      .select({
        bucket: sql<string>`date_bin(make_interval(secs => ${bucketSeconds}), ${signals.createdAt}, to_timestamp(0))`,
        signals: sql<number>`count(*)::int`,
        identities: sql<number>`count(distinct ${signals.origin})::int`,
      })
      .from(signals)
      .where(and(eq(signals.subwire, subwire), gte(signals.createdAt, windowStart)))
      .groupBy(sql`1`),
  ]);

  const byBucket = new Map(rows.map((row) => [new Date(row.bucket).getTime(), row]));
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const atMs = firstBucketMs + index * bucketMs;
    const row = byBucket.get(atMs);
    return {
      at: new Date(atMs).toISOString(),
      signals: row?.signals ?? 0,
      identities: row?.identities ?? 0,
    };
  });

  const body: StatsBody = {
    subwire,
    bucketSeconds,
    generatedAt: new Date(nowMs).toISOString(),
    current: {
      activeSignals: current.activeSignals,
      activeIdentities: current.activeIdentities,
      recentPollers: recentPollerCount(),
    },
    buckets,
  };

  cache.set(cacheKey, { expiresAt: nowMs + STATS_CACHE_TTL_MS, body });
  c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  c.header("X-Subwire-Cache", "MISS");
  return c.json(body);
});
