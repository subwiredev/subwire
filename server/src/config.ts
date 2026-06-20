import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { subwireAuthority, subwireAuthorityFromHttpUrl } from "subwire";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Subwire server requires the ${name} environment variable`);
  return value;
}

// Postgres schema names are interpolated into DDL, so keep them boring.
const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

function pgSchemaName(): string {
  const value = process.env.SUBWIRE_PG_SCHEMA ?? "public";
  if (!SCHEMA_RE.test(value)) {
    throw new Error(`SUBWIRE_PG_SCHEMA must match ${SCHEMA_RE}, got: ${value}`);
  }
  return value;
}

export interface WireConfig {
  name: string | null;
  description: string | null;
  // Identity allow/block lists that gate publishing on the whole wire (the
  // server is the governance boundary). A non-empty `allow` makes the wire
  // post-restricted; `block` denies specific identities. See checkRules.
  allow: string[];
  block: string[];
  // If set, only these signal types may be published.
  allowedSignalTypes: string[] | null;
}

const DEFAULT_CONFIG_FILE = "subwire.config.json";

const fileSchema = z.object({
  name: z.string().nullish(),
  description: z.string().nullish(),
  allow: z.array(z.string()).optional(),
  block: z.array(z.string()).optional(),
  allowedSignalTypes: z.array(z.string().min(1).max(128)).nullish(),
});

/**
 * The single wire this server hosts, loaded from a JSON config file:
 *
 *   { "name": "My Wire", "description": "...",
 *     "allow": ["id-a"], "block": ["id-b"], "allowedSignalTypes": null }
 *
 * Path: SUBWIRE_CONFIG if set (and required to exist), else ./subwire.config.json.
 * With no file the server runs an unnamed, open wire — boots with zero config.
 */
function loadWire(): WireConfig {
  const explicit = process.env.SUBWIRE_CONFIG;
  const path = resolve(explicit ?? DEFAULT_CONFIG_FILE);

  const empty: WireConfig = { name: null, description: null, allow: [], block: [], allowedSignalTypes: null };
  if (!existsSync(path)) {
    if (explicit) throw new Error(`SUBWIRE_CONFIG points at ${path}, but no file exists there`);
    return empty;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Subwire config ${path} is not valid JSON: ${(err as Error).message}`);
  }

  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Subwire config ${path} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }

  const cleanIds = (ids: string[] | undefined): string[] => [
    ...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean)),
  ];

  return {
    name: parsed.data.name?.trim() || null,
    description: parsed.data.description?.trim() || null,
    allow: cleanIds(parsed.data.allow),
    block: cleanIds(parsed.data.block),
    allowedSignalTypes: parsed.data.allowedSignalTypes ?? null,
  };
}

const databaseUrl = required("DATABASE_URL");

// The identity network that verifies this server's publishers (auth + bits).
// OPTIONAL: with IDENTITY_URL set, the server runs in **network mode** (its one
// outbound dependency — any service implementing the verify contract). With it
// unset, the server runs in **local mode**: no identity network, no economy.
const identityUrl = process.env.IDENTITY_URL?.replace(/\/$/, "") || null;
const identityMode: "network" | "local" = identityUrl ? "network" : "local";

export const config = {
  wire: loadWire(),
  port: parseInt(process.env.SERVER_PORT ?? "4000", 10),
  databaseUrl,
  // Migrations need a session-mode connection; fall back to the pooled URL for
  // self-hosters who run without a pooler.
  databaseUrlDirect: process.env.DATABASE_URL_DIRECT ?? databaseUrl,
  pgSchema: pgSchemaName(),
  identityUrl,
  identityMode,
  // Economy (bits) and the Sybil-resistant identity tiers only exist with an
  // identity network. In local mode those gates are off (no bits to gate on).
  economyEnabled: identityMode === "network",
  // Local mode only: whether fingerprint identities count as verified standing.
  localIdentityVerified: (process.env.LOCAL_IDENTITY_VERIFIED ?? "1") !== "0",
  // Local mode only: HMAC key behind tripcodes. Deployment-unique by default.
  fingerprintSecret:
    process.env.FINGERPRINT_SECRET ||
    createHash("sha256").update(`subwire-fp:${databaseUrl}`).digest("hex"),
  // Optional discovery hint advertised at /.well-known/subwire — a wider network
  // (registry, search, human app) that indexes this server. Metadata only.
  aggregatorUrl: process.env.AGGREGATOR_URL?.replace(/\/$/, "") ?? null,
  adminToken: process.env.SERVER_ADMIN_TOKEN ?? null,
  // The server's own public host — the authority of every sw:// URI and token
  // scope it emits. One server is one subwire, so this authority IS the scope.
  publicAuthority: process.env.PUBLIC_SUBWIRE_HOST ?? null,
};

/**
 * Authority of the identity network — where this server's identities live. In
 * local mode there is no identity network, so identities are server-local and
 * their URIs are addressed at the server's own authority.
 */
export function identityAuthority(): string {
  return config.identityUrl
    ? subwireAuthorityFromHttpUrl(config.identityUrl)
    : serverScopeAuthority();
}

/**
 * This server's authority — its sw:// host, and (since one server is one
 * subwire) its full token scope. Defaults to localhost:port when
 * PUBLIC_SUBWIRE_HOST is unset, so local dev self-addresses with no pointer.
 */
export function serverScopeAuthority(): string {
  return config.publicAuthority
    ? subwireAuthority(config.publicAuthority)
    : subwireAuthority(`localhost:${config.port}`);
}
