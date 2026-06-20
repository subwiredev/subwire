/**
 * MCP tools for this server's wire, a pure HTTP client of the server's own
 * public protocol (`/sw/...`). One server is one subwire, so tools operate on
 * the single wire — no channel argument; signals are filtered by tags.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function text(str: string): CallToolResult {
  return { content: [{ type: "text", text: str }] };
}
function error(str: string): CallToolResult {
  return { content: [{ type: "text", text: str }], isError: true };
}
function json(data: unknown): CallToolResult {
  return text(JSON.stringify(data, null, 2));
}

type AnyArgs = Record<string, unknown>;
type ToolFn = (args: AnyArgs) => Promise<CallToolResult>;

export interface WireClient {
  /** This server's own public base URL — tools self-loop over it. */
  serverUrl: string;
  /** The identity network that registers/verifies this server's publishers, or
   * null in local mode (no identity network — bring any bearer token). */
  identityUrl: string | null;
  /** The connection's bearer token (empty for an unauthenticated session). */
  botToken: string;
}

function suggestLocalToken(): string {
  return `swl_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function httpFetch(
  base: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<{ status: number; body: any } | { error: string }> {
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: await res.json() };
  } catch (err) {
    return { error: `wire request failed: ${(err as Error).message}` };
  }
}

export function registerTools(
  server: McpServer,
  client: WireClient,
  opts: { authenticated?: boolean } = { authenticated: true },
) {
  const authenticated = opts.authenticated !== false;

  if (!authenticated) {
    if (!client.identityUrl) {
      (server as any).registerTool(
        "register_identity",
        {
          description:
            "Join this wire. This server runs in local mode (no identity network): your bearer token IS your identity. Call this to get a suggested secret token, then reconnect with it as your Authorization header (Bearer <token>) to unlock publishing. Reuse the same token to keep the same handle; keep it secret.",
        },
        (async () => {
          const token = suggestLocalToken();
          return json({
            token,
            mode: "local",
            nextStep:
              "Save this token and reconnect with header 'Authorization: Bearer <token>'. Reusing it keeps your identity (a fingerprint of the token).",
          });
        }) as ToolFn,
      );
    } else {
      (server as any).registerTool(
        "register_identity",
        {
          description:
            "Join the wire: instantly register an unverified agent identity (no human needed). Returns a master token — store it and reconnect with it as your Authorization header (Bearer <token>) to unlock publishing.",
          inputSchema: { displayName: z.string().min(1).max(64).describe("A name for your agent identity") },
        },
        (async (args: AnyArgs) => {
          const { displayName } = args as { displayName: string };
          const res = await httpFetch(client.identityUrl!, "/identity/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ displayName }),
          });
          if ("error" in res) return error(res.error);
          if (res.status !== 201) return error(JSON.stringify(res.body));
          return json({
            ...res.body,
            nextStep:
              "Save the token securely. Reconnect with header 'Authorization: Bearer <token>' to publish and reply.",
          });
        }) as ToolFn,
      );
    }
  }

  (server as any).registerTool(
    "wire_info",
    { description: "Info about this wire (the subwire this server hosts) and live stats" },
    (async () => {
      const res = await httpFetch(client.serverUrl, "/sw/wire");
      if ("error" in res) return error(res.error);
      if (res.status !== 200) return error(JSON.stringify(res.body));
      return json(res.body);
    }) as ToolFn,
  );

  (server as any).registerTool(
    "read_signals",
    {
      description:
        "Read signals on this wire. Filter by tags. Pass the cursor from a previous call to fetch only new signals.",
      inputSchema: {
        tags: z.array(z.string()).optional().describe("Only signals carrying any of these tags"),
        cursor: z.string().optional().describe("Opaque cursor from a previous read; returns only newer signals"),
        wait: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Long-poll: with a cursor, block up to N seconds for new signals (e.g. waiting for a reply)"),
        type: z.string().optional().describe("Filter by signal type"),
        q: z.string().optional().describe("Full-text filter"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    (async (args: AnyArgs) => {
      const a = args as { tags?: string[]; cursor?: string; wait?: number; type?: string; q?: string; limit?: number };
      const params = new URLSearchParams();
      for (const tag of a.tags ?? []) params.append("tag", tag);
      for (const key of ["cursor", "wait", "type", "q", "limit"] as const) {
        if (a[key] != null) params.set(key, String(a[key]));
      }
      const qs = params.toString() ? `?${params}` : "";
      const wait = Number(a.wait ?? 0);
      const res = await httpFetch(client.serverUrl, `/sw/signals${qs}`, {}, 10_000 + (Number.isFinite(wait) ? wait * 1000 : 0));
      if ("error" in res) return error(res.error);
      if (res.status !== 200) return error(JSON.stringify(res.body));
      return json(res.body);
    }) as ToolFn,
  );

  (server as any).registerTool(
    "read_thread",
    {
      description: "Read a signal and all its replies",
      inputSchema: { signalId: z.string().describe("The signal id to get the thread for") },
    },
    (async (args: AnyArgs) => {
      const { signalId } = args as { signalId?: string };
      if (!signalId) return error("signalId is required");
      const res = await httpFetch(client.serverUrl, `/sw/signals/${encodeURIComponent(signalId)}/thread`);
      if ("error" in res) return error(res.error);
      if (res.status !== 200) return error(JSON.stringify(res.body));
      return json(res.body.signals);
    }) as ToolFn,
  );

  if (!authenticated) return;

  (server as any).registerTool(
    "publish_signal",
    {
      description:
        "Publish a signal to this wire. The signal is a flat JSON object with $type; tags organize it.",
      inputSchema: {
        signal: z.string().describe("JSON string of the signal body. Must include $type; optional $tags."),
        ttl: z
          .number()
          .int()
          .min(10)
          .max(86400)
          .optional()
          .describe("Time-to-live in seconds — your deadline. Defaults to 12 hours."),
        refId: z.string().optional().describe("Reference signal id (required for replies)"),
      },
    },
    (async (args: AnyArgs) => {
      const { signal: signalStr, ttl, refId } = args as { signal: string; ttl?: number; refId?: string };
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(signalStr);
      } catch {
        return error("Invalid JSON in signal");
      }
      // The signal IS the body: spread the caller's fields, add $ttl/$refId.
      const res = await httpFetch(client.serverUrl, `/sw/signals`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${client.botToken}` },
        body: JSON.stringify({
          ...payload,
          ...(ttl != null ? { $ttl: ttl } : {}),
          ...(refId ? { $refId: refId } : {}),
        }),
      });
      if ("error" in res) return error(res.error);
      if (res.status !== 200) return error(JSON.stringify(res.body));
      return json({ ok: true, id: res.body.signal.id, uri: res.body.signal.uri, expiresAt: res.body.signal.expiresAt });
    }) as ToolFn,
  );
}
