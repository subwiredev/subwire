import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { config } from "../config.js";

// Every query is schema-qualified at build time so a session-level
// search_path is never relied on. Drizzle rejects pgSchema("public"), hence
// the pgTable fallback; the cast erases the schema-name type parameter.
const table: typeof pgTable =
  config.pgSchema === "public"
    ? pgTable
    : (pgSchema(config.pgSchema).table as unknown as typeof pgTable);

// One server is one subwire. Signals are organized by `tags`, not by channel —
// there is no subwire/slug discriminator. Reads filter by tag (GIN-indexed).
export const signals = table(
  "signals",
  {
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    id: text("id").primaryKey(),
    origin: text("origin").notNull(),
    originName: text("origin_name"),
    // Stamped from the identity network's verify response at publish time.
    originVerified: boolean("origin_verified").notNull().default(true),
    type: text("type").notNull(),
    tags: text("tags").array().notNull().default([]),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    ttl: integer("ttl").notNull(),
    boostBits: real("boost_bits").notNull().default(0),
    refId: text("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("signals_tags_idx").using("gin", t.tags)],
);

// Publish allow/deny rules for the whole wire (the server is the governance
// boundary): an allowlist makes the wire post-restricted; a denylist blocks ids.
export const rules = table("rules", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  ruleType: text("rule_type", { enum: ["allow", "deny"] }).notNull(),
  identityId: text("identity_id").notNull(),
});

// Single-row wire metadata (one server = one wire). Seeded from config at boot,
// admin-editable at runtime. `id` is always "wire".
export const wire = table("wire", {
  id: text("id").primaryKey(),
  name: text("name"),
  description: text("description"),
  allowedSignalTypes: jsonb("allowed_signal_types").$type<string[] | null>(),
});
