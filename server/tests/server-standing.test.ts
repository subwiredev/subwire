import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer, type SpawnedServer } from "./helpers/server.js";

const FUNDED = "swt_standing_funded";
const BROKE = "swt_standing_broke";

let server: SpawnedServer;

beforeAll(async () => {
  server = await startServer({ name: "standingwire" });
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

// Tests pass a convenient { signal, ttl?, refId? }; the wire body is the flat
// signal with $ttl/$refId envelope keys.
function toWire(body: Record<string, unknown>): Record<string, unknown> {
  const { signal, ttl, refId } = body as {
    signal?: Record<string, unknown>;
    ttl?: number;
    refId?: string | null;
  };
  return {
    ...(signal ?? {}),
    ...(ttl != null ? { $ttl: ttl } : {}),
    ...(refId != null ? { $refId: refId } : {}),
  };
}

async function publish(body: Record<string, unknown>, token: string): Promise<Response> {
  return fetch(`${server.url}/sw/signals`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(toWire(body)),
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

