import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer, type SpawnedServer } from "./helpers/server.js";

const TOKEN = "swt_test_multi";
const ADMIN = "test-server-admin-token";

let server: SpawnedServer;

beforeAll(async () => {
  // One server, three subwires under one authority — the v2 model.
  server = await startServer({ subwires: ["support", "jobs", "incidents"] });
  server.platform.tokens.set(TOKEN, {
    identityId: "agent_multi",
    displayName: "Multi",
    userId: "user_multi",
  });
});

afterAll(async () => {
  await server.stop();
});

async function publish(subwire: string, signal: Record<string, unknown>): Promise<Response> {
  return fetch(server.swUrl(subwire, "/signals"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ signal }),
  });
}

describe("one server, many subwires", () => {
  test("lists every hosted subwire", async () => {
    const body = await (await fetch(server.swUrl("subwires"))).json();
    expect(body.subwires.map((ch: any) => ch.slug).sort()).toEqual([
      "incidents",
      "jobs",
      "support",
    ]);
  });

  test("unknown subwire 404s", async () => {
    const res = await fetch(server.swUrl("marketing", "/signals"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("subwire_not_found");
  });

  test("signals are isolated per subwire", async () => {
    await publish("support", { $type: "request", text: "reset my widget" });
    await publish("jobs", { $type: "offer", text: "hiring a rust dev" });

    const support = await (await fetch(server.swUrl("support", "/signals"))).json();
    const jobs = await (await fetch(server.swUrl("jobs", "/signals"))).json();

    expect(support.signals.some((s: any) => s.payload.text === "reset my widget")).toBe(true);
    expect(support.signals.some((s: any) => s.payload.text === "hiring a rust dev")).toBe(false);
    expect(jobs.signals.some((s: any) => s.payload.text === "hiring a rust dev")).toBe(true);
    // Each signal carries its subwire.
    expect(support.signals[0].subwire).toBe("support");
  });

  test("cursor is per-subwire despite the global seq", async () => {
    const boot = await (await fetch(server.swUrl("incidents", "/signals"))).json();
    // A publish on a DIFFERENT subwire must not surface on incidents' cursor.
    await publish("support", { $type: "request", text: "noise on support" });
    const incr = await (
      await fetch(server.swUrl("incidents", `/signals?cursor=${boot.nextCursor}`))
    ).json();
    expect(incr.signals).toHaveLength(0);
  });

  test("cross-subwire search spans the server's subwires", async () => {
    await publish("incidents", { $type: "broadcast", text: "widget outage in region 4" });

    // Search for "widget" across all hosted subwires.
    const all = await (await fetch(server.swUrl("search", "?q=widget"))).json();
    const subwires = new Set(all.signals.map((s: any) => s.subwire));
    expect(subwires.has("support")).toBe(true); // "reset my widget"
    expect(subwires.has("incidents")).toBe(true); // "widget outage"
    expect(subwires.has("jobs")).toBe(false);

    // Scope to a subset.
    const scoped = await (
      await fetch(server.swUrl("search", "?q=widget&subwires=incidents"))
    ).json();
    expect(scoped.signals.every((s: any) => s.subwire === "incidents")).toBe(true);

    // Filter by type across subwires.
    const offers = await (await fetch(server.swUrl("search", "?type=offer"))).json();
    expect(offers.signals.every((s: any) => s.type === "offer")).toBe(true);
    expect(offers.signals.some((s: any) => s.subwire === "jobs")).toBe(true);
  });

  test("a subwire can be provisioned at runtime", async () => {
    const created = await fetch(server.swUrl("subwires"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ slug: "announcements", name: "Announcements" }),
    });
    expect(created.status).toBe(201);

    // It's immediately publishable — no restart.
    const published = await publish("announcements", { $type: "broadcast", text: "we are live" });
    expect(published.status).toBe(200);

    const read = await (await fetch(server.swUrl("announcements", "/signals"))).json();
    expect(read.signals.some((s: any) => s.payload.text === "we are live")).toBe(true);
  });

  test("provisioning rejects a reserved slug", async () => {
    const res = await fetch(server.swUrl("subwires"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ slug: "search" }),
    });
    expect(res.status).toBe(400);
  });
});
