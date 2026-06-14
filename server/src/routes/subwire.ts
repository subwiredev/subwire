import { Hono } from "hono";
import { subwireUri } from "subwire";
import type { SubwireEnv } from "../subwires.js";
import { serverAuthority } from "../decorate.js";
import { recentPollerCount } from "../presence.js";
import { countActiveSignals, getSubwire } from "../signal-store.js";

export const subwireRoute = new Hono<SubwireEnv>();

subwireRoute.get("/", async (c) => {
  const slug = c.get("subwire");
  const meta = await getSubwire(slug);
  const stats = await countActiveSignals(slug);

  c.header("Cache-Control", "public, max-age=5, stale-while-revalidate=30");
  return c.json({
    slug,
    uri: subwireUri(serverAuthority(c.req.url), slug),
    name: meta?.name ?? slug,
    description: meta?.description ?? null,
    allowedSignalTypes: meta?.allowedSignalTypes ?? null,
    stats: {
      activeSignals: stats.activeSignals,
      activeIdentities: stats.activeIdentities,
      recentPollers: recentPollerCount(),
    },
  });
});
