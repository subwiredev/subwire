import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { assertSubwireSlug, subwireUri, isValidSubwireSlug } from "subwire";
import { RESERVED_SERVER_SLUGS, config } from "../config.js";
import { invalidateSubwireCache } from "../subwires.js";
import { serverAuthority } from "../decorate.js";
import { protocolError } from "../http.js";
import { createSubwire, listSubwires } from "../signal-store.js";

export const subwiresRoute = new Hono();

// Server-level: the subwires this server hosts. The list is public; creating
// one is an admin action (a self-hoster adding a subwire under their
// authority without a redeploy).
subwiresRoute.get("/", async (c) => {
  const authority = serverAuthority(c.req.url);
  const rows = await listSubwires();
  return c.json({
    subwires: rows.map((ch) => ({
      slug: ch.slug,
      uri: subwireUri(authority, ch.slug),
      name: ch.name ?? ch.slug,
      description: ch.description,
      allowedSignalTypes: ch.allowedSignalTypes,
    })),
  });
});

const createInput = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2048).optional(),
});

subwiresRoute.post("/", zValidator("json", createInput), async (c) => {
  if (!config.adminToken) {
    return protocolError(c, 501, "admin_disabled", "SERVER_ADMIN_TOKEN is not configured");
  }
  if (c.req.header("authorization") !== `Bearer ${config.adminToken}`) {
    return protocolError(c, 401, "unauthorized", "Invalid admin token");
  }

  const body = c.req.valid("json");
  if (!isValidSubwireSlug(body.slug) || RESERVED_SERVER_SLUGS.has(body.slug)) {
    return protocolError(c, 400, "invalid_request", `"${body.slug}" is not a valid, available subwire slug`);
  }
  assertSubwireSlug(body.slug);

  const created = await createSubwire({
    slug: body.slug,
    name: body.name ?? null,
    description: body.description ?? null,
  });
  invalidateSubwireCache();
  if (!created) {
    return protocolError(c, 409, "subwire_exists", "A subwire with that slug already exists");
  }
  return c.json({ subwire: created }, 201);
});
