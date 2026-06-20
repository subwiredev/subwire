/**
 * auth.md "service" surface: a subwire server publishes RFC 9728 Protected
 * Resource Metadata pointing at its identity network, plus the /auth.md skill
 * manifest. Network mode advertises the authorization server and the
 * anonymous/claim recipe; local mode documents the bring-your-own-token model.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer, type SpawnedServer } from "./helpers/server.js";

const CLAIM_GRANT = "urn:subwire:agent-auth:grant-type:claim";

describe("auth.md service surface — network mode", () => {
  let server: SpawnedServer;
  beforeAll(async () => {
    server = await startServer({ name: "authmd-wire" });
  });
  afterAll(async () => {
    await server.stop();
  });

  test("Protected Resource Metadata points at the identity network", async () => {
    const res = await fetch(`${server.url}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe(server.url);
    expect(body.authorization_servers).toEqual([server.platform.url]);
    expect(body.bearer_methods_supported).toContain("header");
    expect(body.resource_documentation).toBe(`${server.url}/auth.md`);
    expect(body["x-subwire-identity-mode"]).toBe("network");
  });

  test("/auth.md is the recipe pointing at the identity endpoints", async () => {
    const res = await fetch(`${server.url}/auth.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const md = await res.text();
    expect(md).toContain("auth.md");
    // Names the authorization server and its agent_auth endpoints.
    expect(md).toContain(`${server.platform.url}/agent/identity`);
    expect(md).toContain(`${server.platform.url}/oauth2/token`);
    expect(md).toContain(CLAIM_GRANT);
    // Tells the agent where to actually use the token.
    expect(md).toContain(`${server.url}/sw/signals`);
    expect(md).toContain('"type": "anonymous"');
  });

  test("discovery doc cross-links the auth.md surface", async () => {
    const res = await fetch(`${server.url}/.well-known/subwire`);
    const body = await res.json();
    expect(body.authmd).toBe(`${server.url}/auth.md`);
    expect(body.oauthProtectedResource).toBe(`${server.url}/.well-known/oauth-protected-resource`);
  });
});

describe("auth.md service surface — local mode", () => {
  let server: SpawnedServer;
  beforeAll(async () => {
    server = await startServer({ name: "localwire", env: { IDENTITY_URL: "" } });
  });
  afterAll(async () => {
    await server.stop();
  });

  test("PRM omits the authorization server in local mode", async () => {
    const res = await fetch(`${server.url}/.well-known/oauth-protected-resource`);
    const body = await res.json();
    expect(body.authorization_servers).toBeUndefined();
    expect(body["x-subwire-identity-mode"]).toBe("local");
    expect(body.resource_documentation).toBe(`${server.url}/auth.md`);
  });

  test("/auth.md documents the bring-your-own-token model", async () => {
    const res = await fetch(`${server.url}/auth.md`);
    expect(res.status).toBe(200);
    const md = await res.text();
    expect(md).toContain("local mode");
    expect(md).toContain("at least 8 characters");
    expect(md).toContain(`${server.url}/sw/signals`);
    // No identity-network ceremony in local mode.
    expect(md).not.toContain("/agent/identity");
  });
});
