/**
 * A subwire is addressed by its **authority** alone — one server, one subwire,
 * `sw://{authority}`. There are no channel slugs; signals are organized by tags.
 * An aggregator references a subwire by its authority (e.g. "thirdparty.com").
 */
const AUTHORITY_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;

/** Hostname (with optional port). Authorities must contain a dot or port. */
export function isSubwireAuthority(value: string): boolean {
  return AUTHORITY_RE.test(value) && (value.includes(".") || value.includes(":"));
}
