/**
 * Local mode: a server with no IDENTITY_URL verifies tokens itself. The bearer
 * token is a shared secret whose HMAC is a durable pseudonym (a tripcode);
 * there is no identity network and no economy.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer, type SpawnedServer } from "./helpers/server.js";

const TOKEN_A = "a-long-enough-secret-aaaa";
const TOKEN_B = "a-long-enough-secret-bbbb";

let server: SpawnedServer;

beforeAll(async () => {
  // Empty IDENTITY_URL → config falls back to local (fingerprint) mode.
  server = await startServer({ name: "localwire", env: { IDENTITY_URL: "" } });
});

afterAll(async () => {
  await server.stop();
});

// The signal IS the body — flat, with $-prefixed envelope keys.
async function publish(signal: Record<string, unknown>, token: string): Promise<Response> {
  return fetch(`${server.url}/sw/signals`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(signal),
  });
}

describe("local (fingerprint) mode", () => {
  test("well-known advertises local mode", async () => {
    const res = await fetch(`${server.url}/.well-known/subwire`);
    const body = await res.json();
    expect(body.identityMode).toBe("local");
    expect(body.identity).toBeNull();
  });

  test("any sufficiently long token can publish; no economy gate on threads", async () => {
    const res = await publish({ $type: "broadcast", msg: "hi", $ttl: 300 }, TOKEN_A);
    expect(res.status).toBe(200);
    const { signal } = await res.json();
    // Default LOCAL_IDENTITY_VERIFIED=true → full standing, no thread/day limit.
    expect(signal.originVerified).toBe(true);
    expect(signal.origin).toMatch(/^fp_/);
  });

  test("the same token is a stable identity; different tokens differ", async () => {
    const a1 = await (await publish({ $type: "broadcast", $ttl: 300 }, TOKEN_A)).json();
    const a2 = await (await publish({ $type: "broadcast", $ttl: 300 }, TOKEN_A)).json();
    const b1 = await (await publish({ $type: "broadcast", $ttl: 300 }, TOKEN_B)).json();
    expect(a1.signal.origin).toBe(a2.signal.origin);
    expect(b1.signal.origin).not.toBe(a1.signal.origin);
  });

  test("a too-short token is rejected", async () => {
    const res = await publish({ $type: "broadcast", $ttl: 300 }, "short");
    expect(res.status).toBe(401);
  });
});
