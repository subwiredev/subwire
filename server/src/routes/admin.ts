import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { SubwireEnv } from "../subwires.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { subwires, subwireRules } from "../db/schema.js";
import { protocolError } from "../http.js";
import { invalidateSubwirePolicyCache } from "../rules.js";
import { deleteSignal, getSubwire, getSignal } from "../signal-store.js";

export const adminRoute = new Hono<SubwireEnv>();

adminRoute.use(async (c, next) => {
  if (!config.adminToken) {
    return protocolError(c, 501, "admin_disabled", "SERVER_ADMIN_TOKEN is not configured");
  }
  const header = c.req.header("authorization");
  if (header !== `Bearer ${config.adminToken}`) {
    return protocolError(c, 401, "unauthorized", "Invalid admin token");
  }
  await next();
});

adminRoute.get("/subwire", async (c) => {
  const slug = c.get("subwire");
  const meta = await getSubwire(slug);
  return c.json({
    slug,
    name: meta?.name ?? slug,
    description: meta?.description ?? null,
    allowedSignalTypes: meta?.allowedSignalTypes ?? null,
  });
});

const subwirePatch = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2048).nullable().optional(),
  allowedSignalTypes: z.array(z.string().min(1).max(128)).nullable().optional(),
});

adminRoute.patch("/subwire", zValidator("json", subwirePatch), async (c) => {
  const slug = c.get("subwire");
  const body = c.req.valid("json");
  await db
    .update(subwires)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.allowedSignalTypes !== undefined
        ? { allowedSignalTypes: body.allowedSignalTypes }
        : {}),
    })
    .where(eq(subwires.slug, slug));
  invalidateSubwirePolicyCache(slug);

  const meta = await getSubwire(slug);
  return c.json({
    slug,
    name: meta?.name ?? slug,
    description: meta?.description ?? null,
    allowedSignalTypes: meta?.allowedSignalTypes ?? null,
  });
});

adminRoute.get("/rules", async (c) => {
  const slug = c.get("subwire");
  const rules = await db
    .select()
    .from(subwireRules)
    .where(eq(subwireRules.subwire, slug))
    .orderBy(subwireRules.id);
  return c.json({ rules });
});

const ruleInput = z.object({
  ruleType: z.enum(["allow", "deny"]),
  identityId: z.string().min(1).max(128),
});

adminRoute.post("/rules", zValidator("json", ruleInput), async (c) => {
  const slug = c.get("subwire");
  const body = c.req.valid("json");
  const [rule] = await db
    .insert(subwireRules)
    .values({ subwire: slug, ...body })
    .onConflictDoNothing()
    .returning();
  invalidateSubwirePolicyCache(slug);
  if (!rule) {
    const existing = await db.select().from(subwireRules).where(eq(subwireRules.subwire, slug));
    const match = existing.find(
      (r) => r.ruleType === body.ruleType && r.identityId === body.identityId,
    );
    return c.json({ rule: match }, 200);
  }
  return c.json({ rule }, 201);
});

adminRoute.delete("/rules/:id", async (c) => {
  const slug = c.get("subwire");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return protocolError(c, 400, "invalid_request", "Rule id must be an integer");
  }
  await db.delete(subwireRules).where(and(eq(subwireRules.subwire, slug), eq(subwireRules.id, id)));
  invalidateSubwirePolicyCache(slug);
  return c.json({ ok: true });
});

adminRoute.delete("/signals/:id", async (c) => {
  const slug = c.get("subwire");
  const id = c.req.param("id");
  const existing = await getSignal(slug, id);
  if (!existing) return protocolError(c, 404, "not_found", "Signal not found");
  await deleteSignal(slug, id);
  return c.json({ ok: true });
});
