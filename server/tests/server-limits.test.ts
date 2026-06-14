import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer, type SpawnedServer } from "./helpers/server.js";

const TOKEN = "swt_limit_token";
const EXPIRY_TOKEN = "swt_expiry_token";

let server: SpawnedServer;

beforeAll(async () => {
  server = await startServer({
    slug: "limitwire",
    env: {
      PUBLISH_RATE_LIMIT_MAX: "3",
      PUBLISH_RATE_LIMIT_WINDOW_MS: "60000",
    },
  });
  server.platform.tokens.set(TOKEN, {
    identityId: "agent_limited",
    displayName: "Limited",
    userId: "user_1",
  });
  server.platform.tokens.set(EXPIRY_TOKEN, {
    identityId: "agent_expiry",
    displayName: "Expiry",
    userId: "user_2",
  });
});

afterAll(async () => {
  await server.stop();
});

async function publish(ttl = 60, token = TOKEN): Promise<Response> {
  return fetch(`${server.url}/sw/v1/${server.slug}/signals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ signal: { $type: "broadcast" }, ttl }),
  });
}

describe("publish rate limit", () => {
  test("throttles after the configured budget", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await publish()).status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
    expect(statuses[4]).toBe(429);

    const limited = await publish();
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("expiry semantics", () => {
  test("expired signals leave the active feed but stay readable by id", async () => {
    // Separate identity: the rate-limit test above exhausted TOKEN's budget.
    const res = await publish(10, EXPIRY_TOKEN);
    const { signal } = await res.json();

    // Force-expire it: cheaper and more reliable than sleeping out a TTL.
    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1, prepare: false });
    try {
      await sql.unsafe(
        `UPDATE "${server.schema}".signals SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [signal.id],
      );
    } finally {
      await sql.end();
    }

    const active = await (await fetch(`${server.url}/sw/v1/${server.slug}/signals`)).json();
    expect(active.signals.some((s: any) => s.id === signal.id)).toBe(false);

    const withExpired = await (
      await fetch(`${server.url}/sw/v1/${server.slug}/signals?includeExpired=1&origin=agent_expiry`)
    ).json();
    expect(withExpired.signals.some((s: any) => s.id === signal.id)).toBe(true);

    const detail = await fetch(`${server.url}/sw/v1/${server.slug}/signals/${signal.id}`);
    expect(detail.status).toBe(200);
  });
});

describe("platform outage", () => {
  test("publishes fail closed (401) while the platform is unreachable", async () => {
    server.platform.stop();
    // The previous verify cache entry expires after 30s; use a fresh token to
    // bypass the positive cache instead of waiting.
    const res = await fetch(`${server.url}/sw/v1/${server.slug}/signals`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer swt_never_seen_before",
      },
      body: JSON.stringify({ signal: { $type: "broadcast" }, ttl: 60 }),
    });
    expect(res.status).toBe(401);

    // Reads stay up regardless of platform availability.
    const read = await fetch(`${server.url}/sw/v1/${server.slug}/signals`);
    expect(read.status).toBe(200);
  });
});
