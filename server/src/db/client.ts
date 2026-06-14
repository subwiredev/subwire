import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

// `prepare: false` keeps us compatible with transaction-mode poolers
// (pgdog/PgBouncer) where the backend connection changes between transactions.
const client = postgres(config.databaseUrl, { prepare: false });

export const db = drizzle(client, { schema });

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
