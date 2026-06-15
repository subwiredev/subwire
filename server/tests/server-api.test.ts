import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer, type SpawnedServer } from "./helpers/server.js";

const TOKEN = "swt_test_token_alpha";
const OTHER_TOKEN = "swt_test_token_beta";

let server: SpawnedServer;

beforeAll(async () => {
  server = await startServer({ slug: "testwire" });
  server.platform.tokens.set(TOKEN, {
    identityId: "agent_alpha",
    displayName: "Alpha",
    userId: "user_1",
  });
  server.platform.tokens.set(OTHER_TOKEN, {
    identityId: "agent_beta",
    displayName: "Beta",
    userId: "user_2",
  });
});

afterAll(async () => {
  await server.stop();
});

async function publish(
  body: Record<string, unknown>,
  token: string | null = TOKEN,
): Promise<Response> {
  return fetch(`${server.url}/sw/v1/${server.slug}/signals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("well-known + subwire", () => {
  test("describes the v1 protocol and single subwire", async () => {
    const res = await fetch(`${server.url}/.well-known/subwire`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.protocol).toBe("subwire");
    expect(body.version).toBe("1");
    expect(body.subwires.map((ch: any) => ch.slug)).toContain("testwire");
    expect(body.identity).toBe(server.platform.url);
    expect(body.features).toContain("poll");
  });

  test("GET subwire returns meta and stats", async () => {
    const res = await fetch(`${server.url}/sw/v1/${server.slug}/subwire`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("testwire");
    expect(body.stats.activeSignals).toBeGreaterThanOrEqual(0);
    expect(typeof body.stats.recentPollers).toBe("number");
  });
});

describe("publish auth", () => {
  test("rejects missing and invalid tokens", async () => {
    const missing = await publish({ signal: { $type: "broadcast" }, ttl: 60 }, null);
    expect(missing.status).toBe(401);

    const invalid = await publish({ signal: { $type: "broadcast" }, ttl: 60 }, "swt_nope");
    expect(invalid.status).toBe(401);
  });

  test("accepts a platform-verified token and stamps origin", async () => {
    const res = await publish({ signal: { $type: "broadcast", msg: "hello" }, ttl: 120 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.signal.origin).toBe("agent_alpha");
    expect(body.signal.originName).toBe("Alpha");
    expect(body.signal.uri).toContain("/testwire/signals/");
  });

  test("caches verify results instead of calling the platform per request", async () => {
    const before = server.platform.verifyCalls();
    await publish({ signal: { $type: "broadcast", n: 1 }, ttl: 60 });
    await publish({ signal: { $type: "broadcast", n: 2 }, ttl: 60 });
    const after = server.platform.verifyCalls();
    expect(after - before).toBe(0);
  });
});

describe("publish validation", () => {
  test("requires $type", async () => {
    const res = await publish({ signal: { msg: "untyped" }, ttl: 60 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_request");
  });

  test("reply requires refId", async () => {
    const res = await publish({ signal: { $type: "reply" }, ttl: 60 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("reply_requires_ref");
  });

  test("rejects oversized payloads", async () => {
    const res = await publish(
      { signal: { $type: "broadcast", blob: "x".repeat(20_000) }, ttl: 60 },
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("payload_too_large");
  });

  test("rejects out-of-range ttl", async () => {
    const res = await publish({ signal: { $type: "broadcast" }, ttl: 1 });
    expect(res.status).toBe(400);
  });

  test("ttl is optional and defaults to 12 hours", async () => {
    const res = await publish({ signal: { $type: "broadcast", msg: "no ttl" } });
    expect(res.status).toBe(200);
    const { signal } = await res.json();
    expect(signal.ttl).toBe(43_200);
    const lifetime =
      new Date(signal.expiresAt).getTime() - new Date(signal.createdAt).getTime();
    expect(lifetime).toBe(43_200_000);
  });
});

describe("cursor polling", () => {
  test("bootstrap returns newest page oldest-first with a primed cursor", async () => {
    await publish({ signal: { $type: "broadcast", seq: "a" }, ttl: 300 });
    await publish({ signal: { $type: "broadcast", seq: "b" }, ttl: 300 });

    const res = await fetch(`${server.url}/sw/v1/${server.slug}/signals?limit=100`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals.length).toBeGreaterThanOrEqual(2);
    expect(body.nextCursor).toMatch(/^\d+$/);
    const times = body.signals.map((s: any) => new Date(s.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test("incremental polls return only new signals and advance the cursor", async () => {
    const bootstrap = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals`)).json();
    const cursor = bootstrap.nextCursor;

    const empty = await (
      await fetch(`${server.url}/sw/v1/${server.slug}/signals?cursor=${cursor}`)
    ).json();
    expect(empty.signals).toEqual([]);
    expect(empty.nextCursor).toBe(cursor);

    await publish({ signal: { $type: "broadcast", seq: "fresh" }, ttl: 300 });

    const next = await (
      await fetch(`${server.url}/sw/v1/${server.slug}/signals?cursor=${cursor}`)
    ).json();
    expect(next.signals.length).toBe(1);
    expect(next.signals[0].payload.seq).toBe("fresh");
    expect(Number(next.nextCursor)).toBeGreaterThan(Number(cursor));

    const again = await (
      await fetch(`${server.url}/sw/v1/${server.slug}/signals?cursor=${next.nextCursor}`)
    ).json();
    expect(again.signals).toEqual([]);
  });

  test("rejects malformed cursors", async () => {
    const res = await fetch(`${server.url}/sw/v1/${server.slug}/signals?cursor=banana`);
    expect(res.status).toBe(400);
  });
});

describe("filters", () => {
  test("filters by type, tag, origin, and q", async () => {
    await publish({ signal: { $type: "offer", $tags: ["Compute", "gpu"], item: "h100" }, ttl: 300 });
    await publish({ signal: { $type: "request", item: "zebra-needle" }, ttl: 300 }, OTHER_TOKEN);

    const byType = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals?type=offer`)).json();
    expect(byType.signals.length).toBeGreaterThanOrEqual(1);
    expect(byType.signals.every((s: any) => s.type === "offer")).toBe(true);

    const byTag = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals?tag=GPU`)).json();
    expect(byTag.signals.length).toBeGreaterThanOrEqual(1);
    expect(byTag.signals.every((s: any) => s.tags.includes("gpu"))).toBe(true);

    const byOrigin = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals?origin=agent_beta`)).json();
    expect(byOrigin.signals.length).toBeGreaterThanOrEqual(1);
    expect(byOrigin.signals.every((s: any) => s.origin === "agent_beta")).toBe(true);

    const byQ = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals?q=zebra-needle`)).json();
    expect(byQ.signals.length).toBe(1);
    expect(byQ.signals[0].payload.item).toBe("zebra-needle");
  });
});

describe("threads and detail", () => {
  test("serves a signal with its replies", async () => {
    const rootRes = await publish({ signal: { $type: "broadcast", msg: "root" }, ttl: 300 });
    const root = (await rootRes.json()).signal;

    await publish(
      { signal: { $type: "reply", msg: "child" }, ttl: 300, refId: root.id },
      OTHER_TOKEN,
    );

    const detail = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals/${root.id}`)).json();
    expect(detail.signal.id).toBe(root.id);
    expect(detail.replies.length).toBe(1);
    expect(detail.replies[0].refId).toBe(root.id);

    const thread = await (
      await fetch(`${server.url}/sw/v1/${server.slug}/signals/${root.id}/thread`)
    ).json();
    expect(thread.signals.length).toBe(2);
    expect(thread.signals[0].id).toBe(root.id);
  });

  test("404s unknown signals", async () => {
    const res = await fetch(`${server.url}/sw/v1/${server.slug}/signals/doesnotexist`);
    expect(res.status).toBe(404);
  });
});

describe("admin", () => {
  const adminHeaders = {
    authorization: "Bearer test-server-admin-token",
    "content-type": "application/json",
  };

  test("requires the admin token", async () => {
    const res = await fetch(`${server.url}/sw/v1/${server.slug}/admin/subwire`);
    expect(res.status).toBe(401);
  });

  test("updates subwire meta", async () => {
    const res = await fetch(`${server.url}/sw/v1/${server.slug}/admin/subwire`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ name: "Test Wire", description: "integration subwire" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Test Wire");

    const subwire = await (await fetch(`${server.url}/sw/v1/${server.slug}/subwire`)).json();
    expect(subwire.name).toBe("Test Wire");
  });

  test("deny rules block publishes after the policy cache clears", async () => {
    const created = await fetch(`${server.url}/sw/v1/${server.slug}/admin/rules`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ruleType: "deny", identityId: "agent_beta" }),
    });
    expect(created.status).toBe(201);
    const { rule } = await created.json();

    const denied = await publish({ signal: { $type: "broadcast" }, ttl: 60 }, OTHER_TOKEN);
    expect(denied.status).toBe(403);

    const removed = await fetch(`${server.url}/sw/v1/${server.slug}/admin/rules/${rule.id}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(removed.status).toBe(200);

    const allowed = await publish({ signal: { $type: "broadcast" }, ttl: 60 }, OTHER_TOKEN);
    expect(allowed.status).toBe(200);
  });

  test("moderation delete removes a signal", async () => {
    const res = await publish({ signal: { $type: "broadcast", msg: "doomed" }, ttl: 300 });
    const { signal } = await res.json();

    const del = await fetch(`${server.url}/sw/v1/${server.slug}/admin/signals/${signal.id}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(del.status).toBe(200);

    const detail = await fetch(`${server.url}/sw/v1/${server.slug}/signals/${signal.id}`);
    expect(detail.status).toBe(404);
  });
});

describe("long-poll", () => {
  test("wait blocks until a publish lands, then returns early", async () => {
    const bootstrap = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals`)).json();
    const cursor = bootstrap.nextCursor;

    const started = Date.now();
    const waiting = fetch(`${server.url}/sw/v1/${server.slug}/signals?cursor=${cursor}&wait=10`);
    // Let the long-poll establish, then publish.
    setTimeout(() => {
      void publish({ signal: { $type: "broadcast", seq: "longpoll" }, ttl: 300 });
    }, 300);

    const res = await waiting;
    const elapsed = Date.now() - started;
    const body = await res.json();
    expect(body.signals.length).toBeGreaterThanOrEqual(1);
    expect(body.signals.some((s: any) => s.payload.seq === "longpoll")).toBe(true);
    expect(elapsed).toBeLessThan(5_000); // returned on publish, not the 10s deadline
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("wait without news times out empty at the deadline", async () => {
    const bootstrap = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals`)).json();
    const started = Date.now();
    const res = await fetch(`${server.url}/sw/v1/${server.slug}/signals?cursor=${bootstrap.nextCursor}&wait=1`);
    const body = await res.json();
    expect(body.signals).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });
});

describe("stats", () => {
  test("returns live bucketed stats", async () => {
    const res = await fetch(`${server.url}/sw/v1/${server.slug}/stats?bucketSeconds=60&buckets=10`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subwire).toBe("testwire");
    expect(body.buckets.length).toBe(10);
    expect(body.current.activeSignals).toBeGreaterThan(0);
    const total = body.buckets.reduce((sum: number, b: any) => sum + b.signals, 0);
    expect(total).toBeGreaterThan(0);
  });
});
