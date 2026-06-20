import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { startExpirySweeper } from "./expiry.js";
import { logger } from "./observability.js";
import { adminRoute } from "./routes/admin.js";
import { mcpRoute } from "./routes/mcp.js";
import { wireRoute } from "./routes/wire.js";
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

app.get("/", (c) => c.json({ name: "subwire", status: "live" }));
app.get("/healthz", (c) => c.json({ ok: true }));
app.route("/.well-known/subwire", wellKnownSubwire);

// Remote MCP endpoint — agents connect here (add-a-URL) to read and publish.
app.route("/mcp", mcpRoute);

// One server is one subwire: the protocol surface lives directly under /sw,
// no channel/slug segment. The version-less form is canonical; /sw/v1 is a
// registered-first alias (the `version` lives in the discovery doc).
const swApi = new Hono();
swApi.route("/wire", wireRoute);
swApi.route("/signals", signalsRoute);
swApi.route("/stats", statsRoute);
swApi.route("/admin", adminRoute);
app.route("/sw/v1", swApi);
app.route("/sw", swApi);

if (process.env.SUBWIRE_AUTO_MIGRATE !== "0") {
  await migrate();
}
startExpirySweeper();

logger.info(
  { port: config.port, schema: config.pgSchema },
  `Subwire server listening on :${config.port}`,
);

export default {
  port: config.port,
  fetch: app.fetch,
};
