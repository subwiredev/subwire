import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  assertSubwireSlug,
  subwireAuthority,
  subwireAuthorityFromHttpUrl,
} from "subwire";

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

export interface SubwireSeed {
  slug: string;
  name: string | null;
  description: string | null;
  // Identity allow/block lists that gate publishing, seeded into subwire_rules
  // at boot. A non-empty `allow` makes the subwire allow-list only (sole
  // publishers); `block` denies specific identities. See checkSubwireRules.
  allow: string[];
  block: string[];
}

// Slugs reserved by the server's own /sw/v1 surface so a subwire can't shadow
// the server-level collection routes (/sw/v1/subwires, /sw/v1/search).
export const RESERVED_SERVER_SLUGS = new Set(["subwires", "search"]);

export function assertHostableSlug(slug: string): string {
  if (RESERVED_SERVER_SLUGS.has(slug)) {
    throw new Error(`"${slug}" is reserved by the server API and cannot be a subwire slug`);
  }
  return slug;
}

// Default subwire served when no config file exists, so `bun run start` works
// with zero configuration.
const DEFAULT_SUBWIRE_SLUG = "main";
const DEFAULT_CONFIG_FILE = "subwire.config.json";

const subwireSchema = z.object({
  slug: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  // Identity ids permitted to publish. When present and non-empty, only these
  // identities may publish (allow-list mode).
  allow: z.array(z.string()).optional(),
  // Identity ids forbidden from publishing.
  block: z.array(z.string()).optional(),
});

const fileSchema = z.object({
  subwires: z.array(subwireSchema).min(1, "config file must list at least one subwire"),
});

/**
 * Subwires this server hosts at boot, loaded from a JSON config file:
 *
 *   { "subwires": [{ "slug": "main", "name": "Main", "description": "...",
 *                    "allow": ["pubkey-a"], "block": ["pubkey-b"] }] }
 *
 * Path resolution: SUBWIRE_CONFIG if set (and required to exist), else
 * ./subwire.config.json. When no file is present the server defaults to a
 * single `main` subwire. More can be added at runtime via the admin
 * provisioning API.
 */
function loadSubwires(): SubwireSeed[] {
  const explicit = process.env.SUBWIRE_CONFIG;
  const path = resolve(explicit ?? DEFAULT_CONFIG_FILE);

  if (!existsSync(path)) {
    if (explicit) {
      throw new Error(`SUBWIRE_CONFIG points at ${path}, but no file exists there`);
    }
    return [{ slug: DEFAULT_SUBWIRE_SLUG, name: null, description: null, allow: [], block: [] }];
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

  const seen = new Map<string, SubwireSeed>();
  for (const subwire of parsed.data.subwires) {
    const slug = assertHostableSlug(assertSubwireSlug(subwire.slug.trim()));
    if (!seen.has(slug)) {
      seen.set(slug, {
        slug,
        name: subwire.name?.trim() || null,
        description: subwire.description?.trim() || null,
        allow: cleanIds(subwire.allow),
        block: cleanIds(subwire.block),
      });
    }
  }
  return [...seen.values()];
}

export const config = {
  subwires: loadSubwires(),
  port: parseInt(process.env.SERVER_PORT ?? "4000", 10),
  databaseUrl: required("DATABASE_URL"),
  // Migrations need a session-mode connection; fall back to the pooled URL for
  // self-hosters who run without a pooler.
  databaseUrlDirect: process.env.DATABASE_URL_DIRECT ?? required("DATABASE_URL"),
  pgSchema: pgSchemaName(),
  platformUrl: required("PLATFORM_URL").replace(/\/$/, ""),
  adminToken: process.env.SERVER_ADMIN_TOKEN ?? null,
  // Authority used in sw:// URIs this server emits. First-party subwires are
  // addressed through the platform, so this defaults to the platform authority.
  publicAuthority: process.env.PUBLIC_SUBWIRE_HOST ?? null,
};

export function platformAuthority(): string {
  return subwireAuthorityFromHttpUrl(config.platformUrl);
}

/** The authority half of every subwire scope this server serves. */
export function serverScopeAuthority(): string {
  return config.publicAuthority ? subwireAuthority(config.publicAuthority) : platformAuthority();
}

/**
 * A subwire's fully-qualified scope ("{authority}/{slug}"). Claimed when
 * verifying tokens so the platform can honor subwire-scoped derived tokens.
 */
export function subwireScope(slug: string): string {
  return `${serverScopeAuthority()}/${slug}`;
}
