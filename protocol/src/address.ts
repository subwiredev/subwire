import { isValidSubwireSlug } from "./slug.js";

/**
 * A subwire address identifies a subwire anywhere on the network:
 *   "news"                  — a subwire hosted under the local (default) authority
 *   "thirdparty.com/chan"   — a subwire hosted at another authority
 *
 * An aggregator's viewer URL is the address under /sw/:
 *   sw://thirdparty.com/chan  ↔  subwire.ai/sw/thirdparty.com/chan
 * so third parties never claim names in anyone else's namespace.
 */
export interface SubwireAddress {
  /** null = the local authority (default, authority-relative address) */
  authority: string | null;
  slug: string;
}

const AUTHORITY_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;

/** Hostname (with optional port) — must contain a dot or port so it can never collide with a slug. */
export function isSubwireAuthority(value: string): boolean {
  return AUTHORITY_RE.test(value) && (value.includes(".") || value.includes(":"));
}

export function parseSubwireAddress(input: string): SubwireAddress | null {
  const segments = input.split("/").filter(Boolean);
  if (segments.length === 1 && isValidSubwireSlug(segments[0])) {
    return { authority: null, slug: segments[0] };
  }
  if (
    segments.length === 2 &&
    isSubwireAuthority(segments[0]) &&
    isValidSubwireSlug(segments[1])
  ) {
    return { authority: segments[0].toLowerCase(), slug: segments[1] };
  }
  return null;
}

export function formatSubwireAddress(authority: string | null, slug: string): string {
  return authority ? `${authority}/${slug}` : slug;
}
