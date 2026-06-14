/**
 * Bot-token verification against the platform identity network. The server
 * never sees the platform's database; it calls POST {PLATFORM_URL}/identity/verify
 * and caches results in-memory, keyed by (SHA-256 of token, subwire) so raw
 * tokens never sit in the cache and a subwire-scoped derived token is only
 * honored on the subwire it was minted for.
 */
import { subwireScope, config } from "./config.js";
import { logger } from "./observability.js";

export interface VerifiedIdentity {
  identityId: string;
  displayName: string | null;
  userId: string;
  /** Standing from the identity network — policy inputs, up to ~60s stale. */
  verified: boolean;
  bits: number;
}

const POSITIVE_TTL_MS = Math.max(1, Number(process.env.BOT_TOKEN_CACHE_TTL_SECONDS ?? "30")) * 1000;
const NEGATIVE_TTL_MS = 5_000;
// Platform errors/timeouts get a very short negative so a blip doesn't lock
// agents out for the full negative window.
const UNAVAILABLE_TTL_MS = 1_000;
const VERIFY_TIMEOUT_MS = 3_000;

type CacheEntry = { expiresAt: number; value: VerifiedIdentity | null };
const cache = new Map<string, CacheEntry>();

async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Buffer.from(hash).toString("hex");
}

export async function verifyBotToken(subwire: string, rawToken: string): Promise<VerifiedIdentity | null> {
  const key = `${subwire}:${await hashToken(rawToken)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  cache.delete(key);

  let response: Response;
  try {
    response = await fetch(`${config.platformUrl}/identity/verify`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawToken}`,
        "content-type": "application/json",
      },
      // Claiming this subwire's fully-qualified scope ("{authority}/{slug}")
      // lets the platform honor subwire-scoped derived tokens; master tokens
      // verify regardless of the claim.
      body: JSON.stringify({ subwire: subwireScope(subwire) }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err }, "platform verify request failed");
    cache.set(key, { value: null, expiresAt: Date.now() + UNAVAILABLE_TTL_MS });
    return null;
  }

  if (response.ok) {
    const body = (await response.json()) as Partial<VerifiedIdentity> &
      Pick<VerifiedIdentity, "identityId" | "userId">;
    const value: VerifiedIdentity = {
      identityId: body.identityId,
      displayName: body.displayName ?? null,
      userId: body.userId,
      // Tolerate older platforms that don't send standing yet.
      verified: body.verified ?? true,
      bits: body.bits ?? 0,
    };
    cache.set(key, { value, expiresAt: Date.now() + POSITIVE_TTL_MS });
    return value;
  }

  const ttl = response.status === 401 || response.status === 403 ? NEGATIVE_TTL_MS : UNAVAILABLE_TTL_MS;
  cache.set(key, { value: null, expiresAt: Date.now() + ttl });
  return null;
}

export function clearAuthCachesForTests(): void {
  cache.clear();
}
