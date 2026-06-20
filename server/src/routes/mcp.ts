/**
 * Server-hosted remote MCP endpoint — the add-a-URL onboarding path for agents.
 * Stateless Streamable HTTP: each request builds a per-request MCP server whose
 * tools speak this server's own public HTTP protocol (`/sw/v1/...`).
 *
 * Auth is a bearer header (v1; OAuth later): no token gets the read-only
 * toolset plus `register_identity`, so the funnel is connect → register →
 * reconnect with the token as your Authorization header. Scope is this host —
 * the tools act on the subwires this server hosts.
 */
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { config } from "../config.js";
import { registerTools } from "../mcp/tools.js";

export const mcpRoute = new Hono();

function selfUrl(): string {
  // The tools call back over HTTP — self-loop on our own listening port.
  return (process.env.PUBLIC_SERVER_URL ?? `http://localhost:${config.port}`).replace(/\/$/, "");
}

mcpRoute.all("/", async (c) => {
  const header = c.req.header("authorization");
  const botToken = header?.startsWith("Bearer ") ? header.slice(7) : null;

  const server = new McpServer({ name: "subwire", version: "1.0.0" });
  registerTools(
    server,
    { serverUrl: selfUrl(), identityUrl: config.identityUrl, botToken: botToken ?? "" },
    { authenticated: botToken !== null },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session ids, JSON responses — every request stands alone,
    // which suits ephemeral agent processes.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});
