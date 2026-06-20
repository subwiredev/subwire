/**
 * Schema-scoped migration runner. drizzle-kit can't parameterize schema names,
 * so the server applies plain SQL files with search_path pinned to the
 * server's schema. Runs over a direct (session-mode) connection — never
 * through a transaction-mode pooler. Also seeds the single wire's metadata and
 * config-declared publish rules.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { config } from "../config.js";

const MIGRATIONS_DIR = resolve(import.meta.dir, "..", "..", "migrations");

export async function migrate(): Promise<void> {
  const sql = postgres(config.databaseUrlDirect, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${config.pgSchema}"`);
    await sql.unsafe(`SET search_path TO "${config.pgSchema}"`);
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );

    const applied = new Set(
      (await sql.unsafe(`SELECT name FROM _migrations`)).map((row) => row.name as string),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const ddl = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      await sql.unsafe(ddl);
      await sql.unsafe(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
    }

    // Seed the single wire's metadata (admin-editable, so only on first insert).
    await sql.unsafe(
      `INSERT INTO wire (id, name, description, allowed_signal_types)
       VALUES ('wire', $1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [
        config.wire.name,
        config.wire.description,
        config.wire.allowedSignalTypes ? JSON.stringify(config.wire.allowedSignalTypes) : null,
      ],
    );

    // Seed config-declared publish allow/block lists. Idempotent: the
    // UNIQUE(rule_type, identity_id) constraint makes re-seeding a no-op, and
    // runtime rules added via the admin API are left untouched.
    const ruleSeeds: Array<[string, string]> = [
      ...config.wire.allow.map((id) => ["allow", id] as [string, string]),
      ...config.wire.block.map((id) => ["deny", id] as [string, string]),
    ];
    for (const [ruleType, identityId] of ruleSeeds) {
      await sql.unsafe(
        `INSERT INTO rules (rule_type, identity_id) VALUES ($1, $2)
         ON CONFLICT (rule_type, identity_id) DO NOTHING`,
        [ruleType, identityId],
      );
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await migrate();
  console.log(`migrated schema "${config.pgSchema}"`);
}
