/**
 * Boots a subwire server subprocess against an ephemeral Postgres schema,
 * plus a stub of the platform's /identity/verify endpoint so token auth can
 * be exercised without a running platform.
 */
import type { Subprocess } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";

const ROOT = resolve(import.meta.dir, "..", "..");

export interface StubIdentity {
  identityId: string;
  displayName: string | null;
  userId: string;
  /** standing — defaults applied by the stub: verified, 100 bits */
  verified?: boolean;
  bits?: number;
}

function withStanding(identity: StubIdentity): Record<string, unknown> {
  return { verified: true, bits: 100, ...identity };
}

export interface PlatformStub {
  url: string;
  /** master token -> identity; mutate to grant/revoke tokens mid-test */
  tokens: Map<string, StubIdentity>;
  /**
   * identityId -> identity, consulted for swd_ derived tokens. The stub
   * decodes the (unsigned-checked) payload and enforces the subwire claim,
   * mirroring the platform's contract closely enough for server tests.
   */
  identities: Map<string, StubIdentity>;
  /** count of verify calls, for cache assertions */
  verifyCalls: () => number;
  stop: () => void;
}

export interface SpawnedServer {
  url: string;
  schema: string;
  platform: PlatformStub;
  proc: Subprocess;
  /** Build a wire API URL: swUrl("/signals") -> {base}/sw/signals. */
  swUrl: (suffix?: string) => string;
  stop: () => Promise<void>;
}

export function startPlatformStub(): PlatformStub {
  const tokens = new Map<string, StubIdentity>();
  const identities = new Map<string, StubIdentity>();
  let calls = 0;

  const unauthorized = () =>
    Response.json({ error: { code: "unauthorized", message: "Invalid token" } }, { status: 401 });

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/identity/verify") {
        calls++;
        const header = req.headers.get("authorization");
        const raw = header?.startsWith("Bearer ") ? header.slice(7) : null;
        if (!raw) return unauthorized();

        if (raw.startsWith("swd_")) {
          try {
            const payload = JSON.parse(
              Buffer.from(raw.slice(4).split(".")[0]!, "base64url").toString(),
            ) as { identityId: string; subwire: string };
            const body = (await req.json().catch(() => ({}))) as { authority?: string };
            const identity = identities.get(payload.identityId);
            // A derived token is scoped to an authority (one server = one subwire).
            if (identity && body.authority && payload.subwire === body.authority) {
              return Response.json({ ...withStanding(identity), subwire: payload.subwire });
            }
          } catch {}
          return unauthorized();
        }

        const identity = tokens.get(raw);
        if (!identity) return unauthorized();
        return Response.json(withStanding(identity));
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    tokens,
    identities,
    verifyCalls: () => calls,
    stop: () => server.stop(true),
  };
}

let portCounter = 0;

export async function startServer(opts: {
  name?: string;
  env?: Record<string, string>;
  platform?: PlatformStub;
  /** Claim the server's own host as its sw:// authority (third-party mode). */
  claimOwnAuthority?: boolean;
  /** Wire-level publish rules (the server is the governance boundary). */
  allow?: string[];
  block?: string[];
  allowedSignalTypes?: string[] | null;
} = {}): Promise<SpawnedServer> {
  const schema = `sw_test_${Math.random().toString(36).slice(2, 10)}`;
  const port = 4300 + portCounter++ * 7 + Math.floor(Math.random() * 5);
  const platform = opts.platform ?? startPlatformStub();
  const ownsPlatform = !opts.platform;
  const base = `http://localhost:${port}`;

  const configDir = mkdtempSync(join(tmpdir(), "subwire-test-"));
  const configPath = join(configDir, "subwire.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: opts.name ?? "testwire",
      ...(opts.allow ? { allow: opts.allow } : {}),
      ...(opts.block ? { block: opts.block } : {}),
      ...(opts.allowedSignalTypes !== undefined ? { allowedSignalTypes: opts.allowedSignalTypes } : {}),
    }),
  );

  const proc = Bun.spawn(["bun", "--env-file=.env.test", "run", "src/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      SUBWIRE_CONFIG: configPath,
      SUBWIRE_PG_SCHEMA: schema,
      SERVER_PORT: String(port),
      IDENTITY_URL: platform.url,
      SERVER_ADMIN_TOKEN: "test-server-admin-token",
      ...(opts.claimOwnAuthority ? { PUBLIC_SUBWIRE_HOST: `localhost:${port}` } : {}),
      ...opts.env,
    },
    stdout: process.env.TEST_SERVICE_LOGS === "1" ? "inherit" : "pipe",
    stderr: process.env.TEST_SERVICE_LOGS === "1" ? "inherit" : "pipe",
  });

  await waitForHealthz(base);

  return {
    url: base,
    schema,
    platform,
    proc,
    swUrl: (suffix = "") => `${base}/sw${suffix}`,
    async stop() {
      try {
        proc.kill("SIGTERM");
      } catch {}
      await Promise.race([proc.exited, new Promise((r) => setTimeout(r, 1_000))]);
      try {
        proc.kill("SIGKILL");
      } catch {}
      if (ownsPlatform) platform.stop();
      try {
        rmSync(configDir, { recursive: true, force: true });
      } catch {}
      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1, prepare: false });
      try {
        await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await sql.end();
      }
    },
  };
}

async function waitForHealthz(base: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for subwire server at ${base}`);
}
