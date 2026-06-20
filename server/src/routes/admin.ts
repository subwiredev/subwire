import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { rules, wire } from "../db/schema.js";
import { protocolError } from "../http.js";
import { invalidateWirePolicyCache } from "../rules.js";
import { deleteSignal, getSignal } from "../signal-store.js";

export const adminRoute = new Hono();

adminRoute.use(async (c, next) => {
  if (!config.adminToken) {
    return protocolError(c, 501, "admin_disabled", "SERVER_ADMIN_TOKEN is not configured");
  }
  if (c.req.header("authorization") !== `Bearer ${config.adminToken}`) {
    return protocolError(c, 401, "unauthorized", "Invalid admin token");
  }
  await next();
});

async function wireMeta() {
  const [meta] = await db.select().from(wire).where(eq(wire.id, "wire"));
  return {
    name: meta?.name ?? null,
    description: meta?.description ?? null,
    allowedSignalTypes: meta?.allowedSignalTypes ?? null,
  };
}

adminRoute.get("/wire", async (c) => c.json(await wireMeta()));

const wirePatch = z.object({
  name: z.string().min(1).max(128).nullable().optional(),
  description: z.string().max(2048).nullable().optional(),
  allowedSignalTypes: z.array(z.string().min(1).max(128)).nullable().optional(),
});

adminRoute.patch("/wire", zValidator("json", wirePatch), async (c) => {
  const body = c.req.valid("json");
  await db
    .update(wire)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.allowedSignalTypes !== undefined ? { allowedSignalTypes: body.allowedSignalTypes } : {}),
    })
    .where(eq(wire.id, "wire"));
  invalidateWirePolicyCache();
  return c.json(await wireMeta());
});

adminRoute.get("/rules", async (c) => {
  const ruleRows = await db.select().from(rules).orderBy(rules.id);
  return c.json({ rules: ruleRows });
});

const ruleInput = z.object({
  ruleType: z.enum(["allow", "deny"]),
  identityId: z.string().min(1).max(128),
});

adminRoute.post("/rules", zValidator("json", ruleInput), async (c) => {
  const body = c.req.valid("json");
  const [rule] = await db.insert(rules).values(body).onConflictDoNothing().returning();
  invalidateWirePolicyCache();
  if (!rule) {
    const existing = await db.select().from(rules);
    const match = existing.find((r) => r.ruleType === body.ruleType && r.identityId === body.identityId);
    return c.json({ rule: match }, 200);
  }
  return c.json({ rule }, 201);
});

adminRoute.delete("/rules/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return protocolError(c, 400, "invalid_request", "Rule id must be an integer");
  }
  await db.delete(rules).where(eq(rules.id, id));
  invalidateWirePolicyCache();
  return c.json({ ok: true });
});

adminRoute.delete("/signals/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await getSignal(id);
  if (!existing) return protocolError(c, 404, "not_found", "Signal not found");
  await deleteSignal(id);
  return c.json({ ok: true });
});
