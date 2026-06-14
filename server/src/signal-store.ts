import { and, desc, eq, gt, ilike, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import type { SignalRecord } from "subwire";
import { db } from "./db/client.js";
import { subwires, signals } from "./db/schema.js";

export type { SignalRecord };

export interface SignalSearchQuery {
  subwire: string;
  cursor?: number;
  since?: Date;
  type?: string;
  tag?: string;
  q?: string;
  origin?: string;
  includeExpired?: boolean;
  limit?: number;
}

/** Cross-subwire search over the subwires this server hosts. */
export interface MultiSubwireSearchQuery {
  subwires: string[];
  type?: string;
  tag?: string;
  q?: string;
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

function rowToSignal(row: SignalRow): SignalRecord & { subwire: string } {
  return {
    id: row.id,
    subwire: row.subwire,
    origin: row.origin,
    originName: row.originName ?? null,
    originVerified: row.originVerified,
    type: row.type,
    tags: row.tags ?? [],
    payload: row.payload,
    ttl: row.ttl,
    boostBits: row.boostBits,
    pinned: row.pinned,
    refId: row.refId ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function sortOldestFirst(a: SignalRecord, b: SignalRecord): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

function activeFilter(includeExpired?: boolean) {
  // Pinned signals (standing offers) stay live past their TTL until unpinned.
  if (includeExpired) return undefined;
  return or(gt(signals.expiresAt, sql`now()`), eq(signals.pinned, true))!;
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
  const conditions = [eq(signals.subwire, query.subwire)];
  const active = activeFilter(query.includeExpired);
  if (active) conditions.push(active);
  if (query.since) conditions.push(gt(signals.createdAt, query.since));
  if (query.type) conditions.push(eq(signals.type, query.type));
  if (query.origin) conditions.push(eq(signals.origin, query.origin));
  if (query.tag) {
    conditions.push(sql`${signals.tags} @> ARRAY[${query.tag.toLowerCase()}]::text[]`);
  }
  if (query.q?.trim()) conditions.push(textMatch(query.q));
  return conditions;
}

// In-process new-signal notifier backing the long-poll `wait` param, keyed by
// subwire so a publish only wakes waiters on that subwire. The server is
// single-process by design, so no external bus is needed.
const subwireListeners = new Map<string, Set<() => void>>();

/** Resolves true when a new signal lands on `subwire`, false on timeout. */
export function waitForNewSignal(subwire: string, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const set = subwireListeners.get(subwire) ?? new Set();
    subwireListeners.set(subwire, set);
    const listener = () => {
      clearTimeout(timer);
      set.delete(listener);
      resolve(true);
    };
    const timer = setTimeout(() => {
      set.delete(listener);
      resolve(false);
    }, timeoutMs);
    set.add(listener);
  });
}

function wake(subwire: string): void {
  const set = subwireListeners.get(subwire);
  if (set) for (const listener of [...set]) listener();
}

interface StoredSignal extends SignalRecord {
  subwire: string;
}

export async function upsertSignal(signal: StoredSignal): Promise<void> {
  const values = {
    id: signal.id,
    subwire: signal.subwire,
    origin: signal.origin,
    originName: signal.originName,
    originVerified: signal.originVerified ?? true,
    type: signal.type,
    tags: signal.tags,
    payload: signal.payload,
    ttl: signal.ttl,
    boostBits: signal.boostBits,
    pinned: signal.pinned,
    refId: signal.refId,
    createdAt: signal.createdAt,
    expiresAt: signal.expiresAt,
  };
  await db
    .insert(signals)
    .values(values)
    .onConflictDoUpdate({ target: signals.id, set: values });
  wake(signal.subwire);
}

/**
 * Incremental read for one subwire. With a cursor: signals after that
 * insertion sequence, oldest-first. Without: the newest page, still
 * oldest-first, with nextCursor primed for the first incremental poll.
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

  // Bootstrap page surfaces standing offers first; cursor-incremental reads
  // stay pure seq order (pins of old signals appear on bootstrap only).
  const rows = await db
    .select()
    .from(signals)
    .where(and(...conditions))
    .orderBy(desc(signals.pinned), desc(signals.seq))
    .limit(limit);

  let nextCursor: string;
  if (rows.length > 0) {
    // Max across the page, not rows[0] — pinned-first ordering can put an
    // old (low-seq) standing offer at the head of the page.
    nextCursor = String(Math.max(...rows.map((row) => row.seq)));
  } else {
    const [row] = await db
      .select({ seq: max(signals.seq) })
      .from(signals)
      .where(eq(signals.subwire, query.subwire));
    nextCursor = String(row?.seq ?? 0);
  }
  return { signals: rows.reverse().map(rowToSignal), nextCursor };
}

/** Cross-subwire search across the subwires this server hosts. */
export async function searchAcrossSubwires(
  query: MultiSubwireSearchQuery,
): Promise<(SignalRecord & { subwire: string })[]> {
  const limit = limitOf(query.limit);
  const conditions = [inArray(signals.subwire, query.subwires)];
  const active = activeFilter(query.includeExpired);
  if (active) conditions.push(active);
  if (query.type) conditions.push(eq(signals.type, query.type));
  if (query.tag) {
    conditions.push(sql`${signals.tags} @> ARRAY[${query.tag.toLowerCase()}]::text[]`);
  }
  if (query.q?.trim()) conditions.push(textMatch(query.q));
  const rows = await db
    .select()
    .from(signals)
    .where(and(...conditions))
    .orderBy(desc(signals.pinned), desc(signals.createdAt), signals.id)
    .limit(limit);
  return rows.map(rowToSignal);
}

export async function getSignal(subwire: string, id: string): Promise<(SignalRecord & { subwire: string }) | null> {
  const [row] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.subwire, subwire), eq(signals.id, id)));
  return row ? rowToSignal(row) : null;
}

export async function getSignalThread(subwire: string, id: string): Promise<SignalRecord[]> {
  const [rootRows, replyRows] = await Promise.all([
    db.select().from(signals).where(and(eq(signals.subwire, subwire), eq(signals.id, id))),
    db
      .select()
      .from(signals)
      .where(and(eq(signals.subwire, subwire), eq(signals.refId, id)))
      .orderBy(signals.createdAt)
      .limit(100),
  ]);
  return [...rootRows, ...replyRows].map(rowToSignal).sort(sortOldestFirst);
}

export async function deleteSignal(subwire: string, id: string): Promise<void> {
  await db.delete(signals).where(and(eq(signals.subwire, subwire), eq(signals.id, id)));
}

/** Removes signals that expired more than `graceSeconds` ago. Pinned signals are exempt. */
export async function sweepExpiredSignals(graceSeconds: number): Promise<number> {
  const result = await db
    .delete(signals)
    .where(
      and(
        lte(signals.expiresAt, sql`now() - make_interval(secs => ${graceSeconds})`),
        eq(signals.pinned, false),
      ),
    )
    .returning({ id: signals.id });
  return result.length;
}

/** Pin/unpin a signal. Returns false if the signal doesn't exist on the subwire. */
export async function setSignalPinned(subwire: string, id: string, pinned: boolean): Promise<boolean> {
  const rows = await db
    .update(signals)
    .set({ pinned })
    .where(and(eq(signals.subwire, subwire), eq(signals.id, id)))
    .returning({ id: signals.id });
  return rows.length > 0;
}

/** New threads (root signals) opened by an origin on a subwire in the last 24h. */
export async function countRecentThreads(subwire: string, origin: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(signals)
    .where(
      and(
        eq(signals.subwire, subwire),
        eq(signals.origin, origin),
        isNull(signals.refId),
        gt(signals.createdAt, sql`now() - interval '24 hours'`),
      ),
    );
  return row?.n ?? 0;
}

export async function countActiveSignals(
  subwire: string,
): Promise<{ activeSignals: number; activeIdentities: number }> {
  const [row] = await db
    .select({
      activeSignals: sql<number>`count(*)::int`,
      activeIdentities: sql<number>`count(distinct ${signals.origin})::int`,
    })
    .from(signals)
    .where(and(eq(signals.subwire, subwire), gt(signals.expiresAt, sql`now()`)));
  return row ?? { activeSignals: 0, activeIdentities: 0 };
}

// ── Subwire registry (server-local) ──────────────────────────────────────

export interface SubwireRow {
  slug: string;
  name: string | null;
  description: string | null;
  allowedSignalTypes: string[] | null;
}

export async function listSubwires(): Promise<SubwireRow[]> {
  const rows = await db.select().from(subwires).orderBy(subwires.slug);
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name ?? null,
    description: r.description ?? null,
    allowedSignalTypes: r.allowedSignalTypes ?? null,
  }));
}

export async function getSubwire(slug: string): Promise<SubwireRow | null> {
  const [r] = await db.select().from(subwires).where(eq(subwires.slug, slug));
  return r
    ? {
        slug: r.slug,
        name: r.name ?? null,
        description: r.description ?? null,
        allowedSignalTypes: r.allowedSignalTypes ?? null,
      }
    : null;
}

export async function createSubwire(input: {
  slug: string;
  name?: string | null;
  description?: string | null;
}): Promise<SubwireRow | null> {
  const [r] = await db
    .insert(subwires)
    .values({
      slug: input.slug,
      name: input.name ?? input.slug,
      description: input.description ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return r ? await getSubwire(r.slug) : null;
}
