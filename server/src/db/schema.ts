import {
  bigint,
  boolean,
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

// One server hosts many subwires. Signals carry a `subwire` discriminator;
// reads filter on it, search spans it.
export const subwires = table("subwires", {
  slug: text("slug").primaryKey(),
  name: text("name"),
  description: text("description"),
  allowedSignalTypes: jsonb("allowed_signal_types").$type<string[] | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const signals = table("signals", {
  // Global monotonic insertion order. Reads filter by subwire, so the cursor
  // skips other subwires' seq values — invisible because cursors are opaque.
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  id: text("id").primaryKey(),
  subwire: text("subwire").notNull(),
  origin: text("origin").notNull(),
  originName: text("origin_name"),
  // Stamped from the identity network's verify response at publish time.
  originVerified: boolean("origin_verified").notNull().default(true),
  type: text("type").notNull(),
  tags: text("tags").array().notNull().default([]),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  ttl: integer("ttl").notNull(),
  boostBits: real("boost_bits").notNull().default(0),
  pinned: boolean("pinned").notNull().default(false),
  refId: text("ref_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const subwireRules = table("subwire_rules", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  subwire: text("subwire").notNull(),
  ruleType: text("rule_type", { enum: ["allow", "deny"] }).notNull(),
  identityId: text("identity_id").notNull(),
});
