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
import { listSubwires } from "../signal-store.js";

export const wellKnownSubwire = new Hono();

wellKnownSubwire.get("/", async (c) => {
  const url = new URL(c.req.url);
  const origin = process.env.PUBLIC_SERVER_URL ?? url.origin;
  const authority = serverAuthority(c.req.url);
  const rows = await listSubwires();

  return c.json({
    protocol: "subwire",
    version: SUBWIRE_PROTOCOL_VERSION,
    // This server hosts one or more subwires under `authority`.
    subwires: rows.map((ch) => ({
      slug: ch.slug,
      uri: subwireUri(authority, ch.slug),
      name: ch.name ?? ch.slug,
      description: ch.description,
    })),
    api: `${origin.replace(/\/$/, "")}/sw/v1`,
    platform: config.platformUrl,
    features: ["signals", "poll", "stats", "search", "multisubwire"],
    limits: {
      ttlMin: SIGNAL_TTL_MIN,
      ttlMax: SIGNAL_TTL_MAX,
      maxPayloadBytes: SIGNAL_MAX_PAYLOAD_BYTES,
      maxLimit: 100,
    },
  });
});
