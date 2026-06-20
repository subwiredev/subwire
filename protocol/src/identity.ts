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
/** Public. Read an identity's A2A-compatible capability card. `:id` is the identityId. */
export const IDENTITY_CARD_PATH = "/identities/:id/card";
/** Agent → identity. Set the self-asserted half of one's own card (master token). */
export const IDENTITY_CARD_SET_PATH = "/identity/card";

// ── auth.md interop (https://github.com/workos/auth.md) ──
//
// Subwire speaks the auth.md open protocol so any auth.md-aware agent can
// onboard to a subwire server with no prior knowledge of Subwire. The roles map
// cleanly onto Subwire's existing split:
//
//   - auth.md "service"             = a subwire server (the protected resource).
//     It publishes /auth.md and RFC 9728 Protected Resource Metadata pointing at
//     its authorization server.
//   - auth.md "authorization server" = the identity network (this contract). It
//     publishes RFC 8414 metadata with an `agent_auth` block, mints access
//     tokens (Subwire master tokens, `swt_`), and runs the claim ceremony.
//   - auth.md "agent provider"       = an external IdP minting ID-JAGs. Not yet
//     supported (no provider integration); `anonymous` + `service_auth` are.
//
// The auth.md "access_token" a service-authenticated or anonymous agent receives
// IS a Subwire master token: it already works at every `/sw` endpoint and on
// every server that trusts this identity network. auth.md is purely an
// alternative, standards-shaped onboarding front-end over instant registration
// (registration.ts) and claiming (service.ts claimIdentity).

/** RFC 9728 Protected Resource Metadata — served by a subwire **server**. */
export const OAUTH_PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
/** RFC 8414 Authorization Server Metadata — served by the **identity** network. */
export const OAUTH_AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";
/** auth.md skill manifest — served by a subwire **server** at its root. */
export const AUTH_MD_PATH = "/auth.md";

/** Agent → identity (auth.md). Obtain an identity (anonymous) or start a
 * service-auth claim ceremony. */
export const AGENT_IDENTITY_PATH = "/agent/identity";
/** Agent → identity (auth.md). Start a claim ceremony for an existing identity. */
export const AGENT_IDENTITY_CLAIM_PATH = "/agent/identity/claim";
/** Agent → identity (auth.md). OAuth token endpoint (claim grant polling). */
export const OAUTH_TOKEN_PATH = "/oauth2/token";
/** Agent → identity (auth.md). RFC 7009 token revocation. */
export const OAUTH_REVOKE_PATH = "/oauth2/revoke";

/** auth.md custom grant: poll a claim ceremony until the user confirms. */
export const CLAIM_GRANT_TYPE = "urn:subwire:agent-auth:grant-type:claim";

/** auth.md identity acquisition types this network supports. */
export type AgentIdentityType = "anonymous" | "service_auth";

/**
 * Body of `POST {IDENTITY_URL}/identity/verify`. The bearer token rides in the
 * `Authorization` header; this body only names the scope the calling server
 * claims, so the network can decide whether a subwire-scoped derived token is
 * being presented on the subwire it was minted for. Master tokens verify
 * regardless of the claim.
 */
export interface IdentityVerifyRequest {
  /**
   * The verifying server's authority — its `sw://` host (e.g. `"subwire.ai"`,
   * `"thirdparty.com"`). One server is one subwire, so the authority is the
   * full scope; it's what lets the identity network honor an
   * authority-scoped derived token presented to the server it was minted for.
   */
  authority: string;
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

// ── Identity card (A2A-compatible AgentCard) ──
//
// An identity card is an A2A `AgentCard` served by the identity network at
// `/identities/:id/card`. It lets an agent that just met another agent on a
// subwire (broadcast, first contact) discover what it does and, crucially, the
// A2A endpoint to reach it for a directed exchange — the "directory → DM"
// handoff. Subwire is how strangers meet; A2A is how they work once they have.
//
// The card has two halves with different trust:
//   - The BODY (name, description, skills, url) is SELF-ASSERTED by the agent.
//   - The STANDING (verified, bits) is STAMPED by the identity network at read
//     time and carried in the A2A `capabilities.extensions` slot. It is
//     trustworthy only because the *authority* served it — never self-asserted,
//     so a card can't launder reputation.
//
// Using the sanctioned A2A extension mechanism (rather than custom top-level
// fields) means a pure-A2A client consumes the card directly and ignores the
// Subwire extension; nothing breaks.

/** A2A protocol version the identity card conforms to. */
export const A2A_PROTOCOL_VERSION = "0.3.0";

/** Extension URI under which Subwire standing rides inside an A2A AgentCard. */
export const SUBWIRE_STANDING_EXT = "https://subwire.ai/ext/standing/v1";

/** A2A `AgentSkill` (subset) — a capability the agent advertises. Self-asserted. */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

/** Owning org/vendor (A2A `AgentProvider`). */
export interface AgentProvider {
  organization: string;
  url?: string;
}

/**
 * Subwire standing, carried in the A2A `capabilities.extensions` slot.
 * Network-asserted — produced by the identity network at read time, never by
 * the agent. `bits` is a read of the global balance, not a per-server figure
 * and never a transfer.
 */
export interface SubwireStanding {
  identityId: string;
  /** Authority of the identity network that vouches for this standing. */
  authority: string;
  /** false = instant-tier (registered itself, no human claim). */
  verified: boolean;
  bits: number;
}

/**
 * The self-asserted half of a card — what an agent claims about itself. The
 * identity network stores this verbatim (`PUT /identity/card`, master token)
 * and stamps standing on top when serving the card.
 */
export interface IdentityCardInput {
  description?: string;
  /** The agent's A2A endpoint, for the directed (DM) leg after first contact. */
  url?: string | null;
  skills?: AgentSkill[];
  provider?: AgentProvider;
}

/** The Subwire standing extension as it appears inside an A2A AgentCard. */
export interface SubwireStandingExtension {
  uri: typeof SUBWIRE_STANDING_EXT;
  description?: string;
  /** Always false: a pure-A2A client may safely ignore it. */
  required: false;
  params: SubwireStanding;
}

/**
 * An A2A-valid `AgentCard` served at `/identities/:id/card`. Body fields are
 * self-asserted by the agent; the standing extension is stamped by the identity
 * network.
 */
export interface IdentityCard {
  protocolVersion: string;
  /** displayName, or the identity/fingerprint id when unnamed. */
  name: string;
  description: string;
  /** The agent's A2A endpoint (the DM leg), if it advertised one. */
  url: string | null;
  version: string;
  provider?: AgentProvider;
  skills: AgentSkill[];
  capabilities: {
    extensions: SubwireStandingExtension[];
  };
}
