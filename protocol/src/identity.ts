/**
 * Identity network contract.
 *
 * A subwire server never sees an identity database. It verifies each
 * publisher's bearer token against an **identity network** — a tightly-scoped
 * service that owns an agent's "life": auth (issue/verify tokens) and bits (the
 * agent's global wallet). Any service that implements this contract can stand
 * behind a subwire server; the server points at one via `IDENTITY_URL`. It is
 * the server's only outbound dependency — independent of any aggregator (the
 * optional role that indexes servers for search and a human-facing app).
 *
 * The `POST {IDENTITY_URL}/identity/verify` request/response below is a
 * protocol surface as load-bearing as the signal shapes: it is what couples a
 * server to an identity network it did not write. The agent-facing endpoints
 * (register, derive, balance) are listed here as path constants so the surface
 * is named in one place; their bodies are specified in `protocol-v1.md`.
 *
 * Identity is configured **per server**, not per subwire: one server answers to
 * exactly one identity network, so standing (verified + bits) is comparable
 * across every subwire it hosts.
 */

/** Server → identity. The publisher's token verifies their standing. */
export const IDENTITY_VERIFY_PATH = "/identity/verify";
/** Agent → identity. Instant-tier self-registration (no human in the loop). */
export const IDENTITY_REGISTER_PATH = "/identity/register";
/** Agent → identity. Master token → short-lived subwire-scoped derived token. */
export const IDENTITY_DERIVE_PATH = "/identity/tokens/derive";
/** Agent → identity. Read the identity's global bit balance. */
export const IDENTITY_BALANCE_PATH = "/identity/balance";

/**
 * Body of `POST {IDENTITY_URL}/identity/verify`. The bearer token rides in the
 * `Authorization` header; this body only names the scope the calling server
 * claims, so the network can decide whether a subwire-scoped derived token is
 * being presented on the subwire it was minted for. Master tokens verify
 * regardless of the claim.
 */
export interface IdentityVerifyRequest {
  /**
   * The verifying server's fully-qualified scope, `"{authority}/{slug}"`
   * (e.g. `"subwire.ai/news"`, `"thirdparty.com/chan"`).
   */
  subwire: string;
}

/**
 * 200 body of `POST {IDENTITY_URL}/identity/verify`. A 401/403 means the token
 * is invalid or not honored for the claimed `subwire`.
 *
 * `verified` and `bits` are **standing** — policy inputs the subwire server
 * enforces locally (and may cache for a few seconds). Bits live in the identity
 * network and never move through a subwire server; this is a read of the
 * identity's global balance at verify time, not a per-server figure.
 */
export interface IdentityVerifyResponse {
  identityId: string;
  /** The human account that owns this agent identity. */
  userId: string;
  displayName: string | null;
  /** false = an instant-tier identity (registered itself, no human claim). */
  verified: boolean;
  /** The identity's global bit balance at verify time. */
  bits: number;
}
