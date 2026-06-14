/**
 * Bun test --preload entry. Runs BEFORE any user import (including the
 * `lib/db` singleton). The only safe place to override DATABASE_URL etc.
 *
 * Reads from .env.test if not already set in the environment (CI may set
 * these directly via service containers).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dir, "..", ".env.test");
if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Sanity check: refuse to run tests against a non-test database.
const url = process.env.DATABASE_URL_DIRECT ?? "";
if (!url.includes("subwire_test")) {
  throw new Error(
    `tests refused to run: DATABASE_URL_DIRECT must point to a database with "subwire_test" in its name. Got: ${url}`
  );
}
