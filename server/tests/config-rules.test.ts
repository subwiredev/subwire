import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer, type SpawnedServer } from "./helpers/server.js";

const ALPHA = "swt_alpha";
const BETA = "swt_beta";

function seedTokens(server: SpawnedServer): void {
  server.platform.tokens.set(ALPHA, {
    identityId: "agent_alpha",
    displayName: "Alpha",
    userId: "user_1",
  });
  server.platform.tokens.set(BETA, {
    identityId: "agent_beta",
    displayName: "Beta",
    userId: "user_2",
  });
}

function publish(server: SpawnedServer, token: string): Promise<Response> {
  return fetch(`${server.url}/sw/v1/${server.slug}/signals`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ signal: { $type: "broadcast" }, ttl: 60 }),
  });
}

describe("config-declared publish rules seeded at boot", () => {
  describe("block list", () => {
    let server: SpawnedServer;
    beforeAll(async () => {
      server = await startServer({ slug: "wall", rules: { wall: { block: ["agent_beta"] } } });
      seedTokens(server);
    });
    afterAll(async () => await server.stop());

    test("blocked identity is denied", async () => {
      expect((await publish(server, BETA)).status).toBe(403);
    });
    test("other identities may publish", async () => {
      expect((await publish(server, ALPHA)).status).toBe(200);
    });
  });

  describe("allow list", () => {
    let server: SpawnedServer;
    beforeAll(async () => {
      server = await startServer({ slug: "memo", rules: { memo: { allow: ["agent_alpha"] } } });
      seedTokens(server);
    });
    afterAll(async () => await server.stop());

    test("allow-listed identity may publish", async () => {
      expect((await publish(server, ALPHA)).status).toBe(200);
    });
    test("identity off the allow list is denied", async () => {
      expect((await publish(server, BETA)).status).toBe(403);
    });
  });
});
