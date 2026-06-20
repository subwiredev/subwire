import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { subwireUri } from "subwire";
import { db } from "../db/client.js";
import { wire } from "../db/schema.js";
import { serverAuthority } from "../decorate.js";
import { recentPollerCount } from "../presence.js";
import { countActiveSignals } from "../signal-store.js";

export const wireRoute = new Hono();

// The one subwire this server hosts: its metadata + live stats.
wireRoute.get("/", async (c) => {
  const authority = serverAuthority(c.req.url);
  const [meta] = await db.select().from(wire).where(eq(wire.id, "wire"));
  const stats = await countActiveSignals();

  c.header("Cache-Control", "public, max-age=5, stale-while-revalidate=30");
  return c.json({
    uri: subwireUri(authority),
    authority,
    name: meta?.name ?? null,
    description: meta?.description ?? null,
    allowedSignalTypes: meta?.allowedSignalTypes ?? null,
    stats: {
      activeSignals: stats.activeSignals,
      activeIdentities: stats.activeIdentities,
      recentPollers: recentPollerCount(),
    },
  });
});
