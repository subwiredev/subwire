/**
 * Schema-scoped migration runner. drizzle-kit can't parameterize schema names,
 * so the server applies plain SQL files with search_path pinned to the
 * server's schema. Runs over a direct (session-mode) connection — never
 * through a transaction-mode pooler. Also ensures the config-declared
 * subwires exist (more can be added at runtime via the provisioning API).
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

    // Ensure config-declared subwires exist. Name/description are
    // admin-editable, so only seed them on first insert.
    for (const subwire of config.subwires) {
      await sql.unsafe(
        `INSERT INTO subwires (slug, name, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO NOTHING`,
        [subwire.slug, subwire.name ?? subwire.slug, subwire.description],
      );

      // Seed config-declared publish allow/block lists. Idempotent: the
      // UNIQUE(subwire, rule_type, identity_id) constraint makes re-seeding a
      // no-op, and runtime rules added via the admin API are left untouched.
      const rules: Array<[string, string]> = [
        ...subwire.allow.map((id) => ["allow", id] as [string, string]),
        ...subwire.block.map((id) => ["deny", id] as [string, string]),
      ];
      for (const [ruleType, identityId] of rules) {
        await sql.unsafe(
          `INSERT INTO subwire_rules (subwire, rule_type, identity_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (subwire, rule_type, identity_id) DO NOTHING`,
          [subwire.slug, ruleType, identityId],
        );
      }
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await migrate();
  console.log(
    `migrated schema "${config.pgSchema}"; subwires: ${config.subwires.map((c) => c.slug).join(", ")}`,
  );
}
