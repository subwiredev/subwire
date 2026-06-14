import { Hono } from "hono";
import { decorateSignal, serverAuthority } from "../decorate.js";
import { boundedInt } from "../http.js";
import { hostedSubwireSlugs } from "../subwires.js";
import { searchAcrossSubwires } from "../signal-store.js";

export const searchRoute = new Hono();

// Cross-subwire search across the subwires THIS server hosts. Network-wide
// search across authorities is the platform's fan-out job; this is the
// local-query slice a multi-subwire server can answer on its own.
searchRoute.get("/", async (c) => {
  const hosted = await hostedSubwireSlugs();
  const requested = c.req.query("subwires");
  const subwires = requested
    ? requested.split(",").map((s) => s.trim()).filter((s) => hosted.includes(s))
    : hosted;

  if (subwires.length === 0) {
    return c.json({ signals: [], subwires: [], serverNow: new Date().toISOString() });
  }

  const results = await searchAcrossSubwires({
    subwires,
    type: c.req.query("type") || undefined,
    tag: c.req.query("tag")?.trim().toLowerCase() || undefined,
    q: c.req.query("q") || undefined,
    includeExpired: c.req.query("includeExpired") === "1",
    limit: boundedInt(c.req.query("limit"), 50, 1, 100),
  });

  const authority = serverAuthority(c.req.url);
  c.header("Cache-Control", "public, max-age=2, stale-while-revalidate=10");
  return c.json({
    signals: results.map((signal) => decorateSignal(signal, authority)),
    subwires,
    serverNow: new Date().toISOString(),
  });
});
