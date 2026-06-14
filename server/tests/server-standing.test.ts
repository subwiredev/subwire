import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer, type SpawnedServer } from "./helpers/server.js";

const FUNDED = "swt_standing_funded";
const BROKE = "swt_standing_broke";
const ADMIN = { authorization: "Bearer test-server-admin-token" };

let server: SpawnedServer;

beforeAll(async () => {
  server = await startServer({ slug: "standingwire" });
  server.platform.tokens.set(FUNDED, {
    identityId: "agent_funded",
    displayName: "Funded",
    userId: "user_1",
    bits: 100,
  });
  server.platform.tokens.set(BROKE, {
    identityId: "agent_broke",
    displayName: "Broke",
    userId: "user_2",
    bits: 0,
  });
});

afterAll(async () => {
  await server.stop();
});

async function publish(body: Record<string, unknown>, token: string): Promise<Response> {
  return fetch(`${server.url}/sw/v1/${server.slug}/signals`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe("balance gate", () => {
  test("zero-bit identities cannot open threads but can reply", async () => {
    const denied = await publish({ signal: { $type: "request", msg: "help?" }, ttl: 300 }, BROKE);
    expect(denied.status).toBe(402);
    const body = await denied.json();
    expect(body.error.code).toBe("insufficient_standing");

    const rootRes = await publish({ signal: { $type: "broadcast", msg: "root" }, ttl: 300 }, FUNDED);
    expect(rootRes.status).toBe(200);
    const { signal: root } = await rootRes.json();

    const reply = await publish(
      { signal: { $type: "reply", msg: "I can help" }, ttl: 300, refId: root.id },
      BROKE,
    );
    expect(reply.status).toBe(200);
  });
});

describe("unverified (instant-tier) enforcement", () => {
  const INSTANT = "swt_standing_instant";

  beforeAll(() => {
    server.platform.tokens.set(INSTANT, {
      identityId: "agent_instant",
      displayName: "Instant",
      userId: "instant_tier",
      verified: false,
      bits: 10,
    });
  });

  test("one thread per day, unlimited-ish replies, provenance stamped", async () => {
    const first = await publish({ signal: { $type: "request", msg: "help me" }, ttl: 300 }, INSTANT);
    expect(first.status).toBe(200);
    const { signal } = await first.json();
    expect(signal.originVerified).toBe(false);

    const second = await publish({ signal: { $type: "request", msg: "more help" }, ttl: 300 }, INSTANT);
    expect(second.status).toBe(403);
    expect((await second.json()).error.code).toBe("unverified_limited");

    const reply = await publish(
      { signal: { $type: "reply", msg: "self-reply" }, ttl: 300, refId: signal.id },
      INSTANT,
    );
    expect(reply.status).toBe(200);

    // Verified identities' signals carry originVerified: true.
    const fundedRoot = await publish({ signal: { $type: "broadcast" }, ttl: 300 }, FUNDED);
    expect((await fundedRoot.json()).signal.originVerified).toBe(true);
  });
});

describe("pinned standing offers", () => {
  test("pin ranks first on bootstrap, survives TTL, and unpins cleanly", async () => {
    const offerRes = await publish(
      { signal: { $type: "offer", msg: "standing offer: translations" }, ttl: 10 },
      FUNDED,
    );
    const { signal: offer } = await offerRes.json();

    // A couple of newer signals so the pin isn't trivially first.
    await publish({ signal: { $type: "broadcast", msg: "newer 1" }, ttl: 300 }, FUNDED);
    await publish({ signal: { $type: "broadcast", msg: "newer 2" }, ttl: 300 }, FUNDED);

    const pinRes = await fetch(`${server.url}/sw/v1/${server.slug}/admin/signals/${offer.id}/pin`, {
      method: "POST",
      headers: ADMIN,
    });
    expect(pinRes.status).toBe(200);

    // Force-expire the pinned signal: it must remain readable + listed.
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1, prepare: false });
    try {
      await sql.unsafe(
        `UPDATE "${server.schema}".signals SET expires_at = now() - interval '1 hour' WHERE id = $1`,
        [offer.id],
      );
    } finally {
      await sql.end();
    }

    const bootstrap = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals`)).json();
    const listed = bootstrap.signals.find((s: any) => s.id === offer.id);
    expect(listed).toBeTruthy();
    expect(listed.pinned).toBe(true);

    // Cursor priming must not regress to the old pinned signal's seq: an
    // incremental poll from the bootstrap cursor returns nothing new.
    const incremental = await (
      await fetch(`${server.url}/sw/v1/${server.slug}/signals?cursor=${bootstrap.nextCursor}`)
    ).json();
    expect(incremental.signals).toEqual([]);

    const unpin = await fetch(`${server.url}/sw/v1/${server.slug}/admin/signals/${offer.id}/pin`, {
      method: "DELETE",
      headers: ADMIN,
    });
    expect(unpin.status).toBe(200);

    // Unpinned + already expired → gone from the active feed.
    const after = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals`)).json();
    expect(after.signals.some((s: any) => s.id === offer.id)).toBe(false);
  });
});
