/**
 * Bot-token verification. The result shape (`VerifiedIdentity`) is the protocol
 * verify contract; how it's produced is a seam with two implementations the
 * server picks by config:
 *
 *  - **network** (IDENTITY_URL set): calls POST {IDENTITY_URL}/identity/verify
 *    (the published contract) and caches results in-memory, keyed by (SHA-256 of
 *    token, subwire) so raw tokens never sit in the cache and a subwire-scoped
 *    derived token is only honored on the subwire it was minted for.
 *  - **local** (no IDENTITY_URL): no identity network. The bearer token is a
 *    shared secret; its server-keyed HMAC is a durable pseudonym (a "tripcode").
 *    Possession of the token *is* the identity — no registration, no economy.
 */
import { createHmac } from "node:crypto";
import {
  IDENTITY_VERIFY_PATH,
  type IdentityVerifyRequest,
  type IdentityVerifyResponse,
} from "subwire";
import { serverScopeAuthority, config } from "./config.js";
import { logger } from "./observability.js";

/** Standing — policy inputs the server enforces locally (up to ~60s stale in
 * network mode). */
export type VerifiedIdentity = IdentityVerifyResponse;

const POSITIVE_TTL_MS = Math.max(1, Number(process.env.BOT_TOKEN_CACHE_TTL_SECONDS ?? "30")) * 1000;
const NEGATIVE_TTL_MS = 5_000;
// Identity-network errors/timeouts get a very short negative so a blip doesn't
// lock agents out for the full negative window.
const UNAVAILABLE_TTL_MS = 1_000;
const VERIFY_TIMEOUT_MS = 3_000;

type CacheEntry = { expiresAt: number; value: VerifiedIdentity | null };
const cache = new Map<string, CacheEntry>();

async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Buffer.from(hash).toString("hex");
}

// Local mode: the token must be a real secret, not a throwaway. Below this we
// reject outright so an empty/trivial token can't mint a fingerprint identity.
const MIN_LOCAL_TOKEN_LEN = 8;

/**
 * Local (no identity network) verification: the token's HMAC under a
 * deployment-unique key is the identity. Pure compute — no DB, no network, no
 * cache. Standing is fixed by config: `verified` per LOCAL_IDENTITY_VERIFIED,
 * and `bits: 0` (the economy is off in local mode; its gates are bypassed).
 */
function fingerprintIdentity(rawToken: string): VerifiedIdentity | null {
  const token = rawToken.trim();
  if (token.length < MIN_LOCAL_TOKEN_LEN) return null;
  const mac = createHmac("sha256", config.fingerprintSecret).update(token).digest("hex");
  const id = `fp_${mac.slice(0, 20)}`;
  return {
    identityId: id,
    userId: id,
    displayName: null,
    verified: config.localIdentityVerified,
    bits: 0,
  };
}

export async function verifyBotToken(rawToken: string): Promise<VerifiedIdentity | null> {
  if (config.identityMode === "local") return fingerprintIdentity(rawToken);
  const key = await hashToken(rawToken);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  cache.delete(key);

  let response: Response;
  try {
    // Claiming this server's authority (one server is one subwire) lets the
    // identity network honor an authority-scoped derived token; master tokens
    // verify regardless of the claim.
    const verifyBody: IdentityVerifyRequest = { authority: serverScopeAuthority() };
    response = await fetch(`${config.identityUrl}${IDENTITY_VERIFY_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(verifyBody),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err }, "identity verify request failed");
    cache.set(key, { value: null, expiresAt: Date.now() + UNAVAILABLE_TTL_MS });
    return null;
  }

  if (response.ok) {
    const body = (await response.json()) as Partial<IdentityVerifyResponse> &
      Pick<IdentityVerifyResponse, "identityId" | "userId">;
    const value: VerifiedIdentity = {
      identityId: body.identityId,
      displayName: body.displayName ?? null,
      userId: body.userId,
      // Tolerate older identity networks that don't send standing yet.
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
