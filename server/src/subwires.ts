import { listSubwires } from "./signal-store.js";

/** Hono context env: the `:slug` middleware resolves and stashes the subwire. */
export type SubwireEnv = { Variables: { subwire: string } };

const CACHE_TTL_MS = 10_000;
let cache: { expiresAt: number; slugs: Set<string> } | null = null;

export async function isHostedSubwire(slug: string): Promise<boolean> {
  if (!cache || cache.expiresAt < Date.now()) {
    const rows = await listSubwires();
    cache = { slugs: new Set(rows.map((r) => r.slug)), expiresAt: Date.now() + CACHE_TTL_MS };
  }
  return cache.slugs.has(slug);
}

export async function hostedSubwireSlugs(): Promise<string[]> {
  if (!cache || cache.expiresAt < Date.now()) await isHostedSubwire("");
  return [...(cache?.slugs ?? [])];
}

export function invalidateSubwireCache(): void {
  cache = null;
}
