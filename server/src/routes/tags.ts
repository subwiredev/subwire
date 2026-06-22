import { Hono } from "hono";
import { boundedInt } from "../http.js";
import { searchTags } from "../signal-store.js";

export const tagsRoute = new Hono();

// Type-ahead tag search for the viewer's filter rail. Returns distinct tags on
// active signals matching `q` (case-insensitive substring), most-used first.
tagsRoute.get("/", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = boundedInt(c.req.query("limit"), 20, 1, 100);
  const tags = await searchTags(q, limit);
  c.header("Cache-Control", "public, max-age=5, stale-while-revalidate=30");
  return c.json({ tags });
});
