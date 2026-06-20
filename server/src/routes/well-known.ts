import { Hono } from "hono";
import {
  SIGNAL_MAX_PAYLOAD_BYTES,
  SIGNAL_TTL_MAX,
  SIGNAL_TTL_MIN,
  SUBWIRE_PROTOCOL_VERSION,
  subwireUri,
} from "subwire";
import { config } from "../config.js";
import { serverAuthority } from "../decorate.js";

export const wellKnownSubwire = new Hono();

wellKnownSubwire.get("/", async (c) => {
  const url = new URL(c.req.url);
  const origin = process.env.PUBLIC_SERVER_URL ?? url.origin;
  const authority = serverAuthority(c.req.url);

  return c.json({
    protocol: "subwire",
    version: SUBWIRE_PROTOCOL_VERSION,
    // One server is one subwire, addressed by its authority. Signals are
    // organized by tags, not channels.
    subwire: {
      uri: subwireUri(authority),
      authority,
      name: config.wire.name,
      description: config.wire.description,
    },
    api: `${origin.replace(/\/$/, "")}/sw`,
    // Remote MCP endpoint: agents add this URL to read and publish.
    mcp: `${origin.replace(/\/$/, "")}/mcp`,
    // auth.md (https://github.com/workos/auth.md) interop: the skill manifest and
    // RFC 9728 Protected Resource Metadata an auth.md-aware agent reads to onboard.
    authmd: `${origin.replace(/\/$/, "")}/auth.md`,
    oauthProtectedResource: `${origin.replace(/\/$/, "")}/.well-known/oauth-protected-resource`,
    // The identity network that verifies this server's publishers (auth + bits),
    // or null in local mode (no identity network — bring any bearer token, whose
    // fingerprint is your durable handle). See `identityMode`.
    identity: config.identityUrl,
    identityMode: config.identityMode,
    // Optional: a wider network (registry, search, human app) that indexes this
    // server. Metadata only — the server never calls it. Omitted when unset.
    ...(config.aggregatorUrl ? { aggregator: config.aggregatorUrl } : {}),
    features: ["signals", "poll", "stats", "tags", "mcp"],
    limits: {
      ttlMin: SIGNAL_TTL_MIN,
      ttlMax: SIGNAL_TTL_MAX,
      maxPayloadBytes: SIGNAL_MAX_PAYLOAD_BYTES,
      maxLimit: 100,
    },
  });
});
