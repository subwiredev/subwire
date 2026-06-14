import { Hono } from "hono";
import { cors } from "hono/cors";
import { type SubwireEnv, isHostedSubwire } from "./subwires.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { startExpirySweeper } from "./expiry.js";
import { protocolError } from "./http.js";
import { logger } from "./observability.js";
import { adminRoute } from "./routes/admin.js";
import { subwireRoute } from "./routes/subwire.js";
import { subwiresRoute } from "./routes/subwires.js";
import { searchRoute } from "./routes/search.js";
import { signalsRoute } from "./routes/signals.js";
import { statsRoute } from "./routes/stats.js";
import { wellKnownSubwire } from "./routes/well-known.js";

const app = new Hono();

app.onError((err, c) => {
  logger.error({ err, route: c.req.path }, "unhandled server error");
  return c.json({ error: "Internal server error" }, 500);
});

// Reads are public and auth is bearer-token based (no cookies), so an open
// CORS policy is safe and saves every self-hoster a config step.
app.use("*", cors({ origin: "*" }));

app.get("/", (c) =>
  c.json({ name: "subwire", status: "live", subwires: config.subwires.map((ch) => ch.slug) }),
);
app.get("/healthz", (c) => c.json({ ok: true }));
app.route("/.well-known/subwire", wellKnownSubwire);

// Per-subwire API. A `:slug` middleware resolves the subwire (404 if this
// server doesn't host it) and stashes it on the context for the routes.
const subwireApp = new Hono<SubwireEnv>();
subwireApp.use("*", async (c, next) => {
  const slug = c.req.param("slug");
  if (!slug || !(await isHostedSubwire(slug))) {
    return protocolError(c, 404, "subwire_not_found", "This server does not host that subwire");
  }
  c.set("subwire", slug);
  await next();
});
subwireApp.route("/subwire", subwireRoute);
subwireApp.route("/signals", signalsRoute);
subwireApp.route("/stats", statsRoute);
subwireApp.route("/admin", adminRoute);

const swV1 = new Hono();
// Server-level collection routes are registered before the :slug catch-all,
// and their slugs are reserved (see config) so a subwire can't shadow them.
swV1.route("/subwires", subwiresRoute);
swV1.route("/search", searchRoute);
swV1.route("/:slug", subwireApp);
app.route("/sw/v1", swV1);

if (process.env.SUBWIRE_AUTO_MIGRATE !== "0") {
  await migrate();
}
startExpirySweeper();

logger.info(
  { port: config.port, schema: config.pgSchema, subwires: config.subwires.map((c) => c.slug) },
  `Subwire server listening on :${config.port} (subwires: ${config.subwires.map((c) => c.slug).join(", ")})`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
