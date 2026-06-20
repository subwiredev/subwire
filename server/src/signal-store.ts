import { and, desc, eq, gt, ilike, isNull, lte, max, or, sql } from "drizzle-orm";
import type { SignalRecord } from "subwire";
import { db } from "./db/client.js";
import { signals } from "./db/schema.js";

export type { SignalRecord };

export interface SignalSearchQuery {
  cursor?: number;
  since?: Date;
  type?: string;
  tags?: string[];
  q?: string;
  origin?: string;
  includeExpired?: boolean;
  limit?: number;
}

export interface SignalPage {
  signals: SignalRecord[];
  nextCursor: string;
}

const MAX_SIGNAL_LIMIT = 100;
const DEFAULT_SIGNAL_LIMIT = 100;

function limitOf(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SIGNAL_LIMIT;
  return Math.max(1, Math.min(MAX_SIGNAL_LIMIT, Number(value)));
}

type SignalRow = typeof signals.$inferSelect;

function rowToSignal(row: SignalRow): SignalRecord {
  return {
    id: row.id,
    origin: row.origin,
    originName: row.originName ?? null,
    originVerified: row.originVerified,
    type: row.type,
    tags: row.tags ?? [],
    payload: row.payload,
    ttl: row.ttl,
    boostBits: row.boostBits,
    refId: row.refId ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function sortOldestFirst(a: SignalRecord, b: SignalRecord): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

function activeFilter(includeExpired?: boolean) {
  if (includeExpired) return undefined;
  return gt(signals.expiresAt, sql`now()`);
}

function textMatch(q: string) {
  const needle = `%${q.trim().toLowerCase()}%`;
  return or(
    ilike(signals.id, needle),
    ilike(signals.origin, needle),
    ilike(signals.originName, needle),
    ilike(signals.type, needle),
    sql`array_to_string(${signals.tags}, ' ') ILIKE ${needle}`,
    sql`${signals.payload}::text ILIKE ${needle}`,
  )!;
}

function searchConditions(query: SignalSearchQuery) {
  const conditions = [];
  const active = activeFilter(query.includeExpired);
  if (active) conditions.push(active);
  if (query.since) conditions.push(gt(signals.createdAt, query.since));
  if (query.type) conditions.push(eq(signals.type, query.type));
  if (query.origin) conditions.push(eq(signals.origin, query.origin));
  if (query.tags && query.tags.length > 0) {
    // OR across tags: a signal matches if it carries any of the requested tags.
    const lowered = query.tags.map((t) => t.toLowerCase());
    conditions.push(sql`${signals.tags} && ARRAY[${sql.join(lowered, sql`,`)}]::text[]`);
  }
  if (query.q?.trim()) conditions.push(textMatch(query.q));
  return conditions;
}

// In-process new-signal notifier backing the long-poll `wait` param. The server
// is one subwire and single-process by design, so a single waiter set suffices.
const listeners = new Set<() => void>();

/** Resolves true when a new signal lands, false on timeout. */
export function waitForNewSignal(timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const listener = () => {
      clearTimeout(timer);
      listeners.delete(listener);
      resolve(true);
    };
    const timer = setTimeout(() => {
      listeners.delete(listener);
      resolve(false);
    }, timeoutMs);
    listeners.add(listener);
  });
}

function wake(): void {
  for (const listener of [...listeners]) listener();
}

export async function upsertSignal(signal: SignalRecord): Promise<void> {
  const values = {
    id: signal.id,
    origin: signal.origin,
    originName: signal.originName,
    originVerified: signal.originVerified ?? true,
    type: signal.type,
    tags: signal.tags,
    payload: signal.payload,
    ttl: signal.ttl,
    boostBits: signal.boostBits,
    refId: signal.refId,
    createdAt: signal.createdAt,
    expiresAt: signal.expiresAt,
  };
  await db.insert(signals).values(values).onConflictDoUpdate({ target: signals.id, set: values });
  wake();
}

/**
 * Incremental read. With a cursor: signals after that insertion sequence,
 * oldest-first. Without: the newest page, still oldest-first, with nextCursor
 * primed for the first incremental poll.
 */
export async function listActiveSignals(query: SignalSearchQuery): Promise<SignalPage> {
  const limit = limitOf(query.limit);
  const conditions = searchConditions(query);

  if (query.cursor != null) {
    const rows = await db
      .select()
      .from(signals)
      .where(and(gt(signals.seq, query.cursor), ...conditions))
      .orderBy(signals.seq)
      .limit(limit);
    const nextCursor = rows.length > 0 ? String(rows[rows.length - 1].seq) : String(query.cursor);
    return { signals: rows.map(rowToSignal), nextCursor };
  }

  // Bootstrap page: newest first by insertion order.
  const rows = await db
    .select()
    .from(signals)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(signals.seq))
    .limit(limit);

  let nextCursor: string;
  if (rows.length > 0) {
    nextCursor = String(rows[0].seq);
  } else {
    const [row] = await db.select({ seq: max(signals.seq) }).from(signals);
    nextCursor = String(row?.seq ?? 0);
  }
  return { signals: rows.reverse().map(rowToSignal), nextCursor };
}

export async function getSignal(id: string): Promise<SignalRecord | null> {
  const [row] = await db.select().from(signals).where(eq(signals.id, id));
  return row ? rowToSignal(row) : null;
}

export async function getSignalThread(id: string): Promise<SignalRecord[]> {
  const [rootRows, replyRows] = await Promise.all([
    db.select().from(signals).where(eq(signals.id, id)),
    db.select().from(signals).where(eq(signals.refId, id)).orderBy(signals.createdAt).limit(100),
  ]);
  return [...rootRows, ...replyRows].map(rowToSignal).sort(sortOldestFirst);
}

export async function deleteSignal(id: string): Promise<void> {
  await db.delete(signals).where(eq(signals.id, id));
}

/** Removes signals that expired more than `graceSeconds` ago. */
export async function sweepExpiredSignals(graceSeconds: number): Promise<number> {
  const result = await db
    .delete(signals)
    .where(lte(signals.expiresAt, sql`now() - make_interval(secs => ${graceSeconds})`))
    .returning({ id: signals.id });
  return result.length;
}

/** New threads (root signals) opened by an origin in the last 24h. */
export async function countRecentThreads(origin: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(signals)
    .where(
      and(
        eq(signals.origin, origin),
        isNull(signals.refId),
        gt(signals.createdAt, sql`now() - interval '24 hours'`),
      ),
    );
  return row?.n ?? 0;
}

export async function countActiveSignals(): Promise<{ activeSignals: number; activeIdentities: number }> {
  const [row] = await db
    .select({
      activeSignals: sql<number>`count(*)::int`,
      activeIdentities: sql<number>`count(distinct ${signals.origin})::int`,
    })
    .from(signals)
    .where(gt(signals.expiresAt, sql`now()`));
  return row ?? { activeSignals: 0, activeIdentities: 0 };
}
