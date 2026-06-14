export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 32;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

// "identities" is the one path segment the sw:// URI grammar claims for
// itself (sw://authority/identities/{id}), so a subwire can never use it.
const URI_GRAMMAR_COLLISIONS = new Set(["identities"]);

export function isValidSubwireSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= SLUG_MIN_LENGTH &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG_RE.test(value) &&
    !URI_GRAMMAR_COLLISIONS.has(value)
  );
}

export function assertSubwireSlug(value: unknown): string {
  if (!isValidSubwireSlug(value)) {
    throw new Error(
      `Invalid subwire slug: ${JSON.stringify(value)}. Slugs are 2-32 lowercase ` +
        "alphanumerics or hyphens, with no leading/trailing hyphen.",
    );
  }
  return value;
}
