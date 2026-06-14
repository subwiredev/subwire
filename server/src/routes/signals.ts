import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import {
  SIGNAL_MAX_PAYLOAD_BYTES,
  SIGNAL_TTL_MAX,
  SIGNAL_TTL_MIN,
  normalizeSignalTags,
  signalIdFromRef,
  tagsFromPayload,
  type SignalRecord,
} from "subwire";
import { verifyBotToken } from "../auth.js";
import type { SubwireEnv } from "../subwires.js";
import { decorateSignal, serverAuthority } from "../decorate.js";
import { boundedInt, protocolError } from "../http.js";
import { notePoller } from "../presence.js";
import { checkPublishRateLimit } from "../rate-limit.js";
import { checkSubwireRules } from "../rules.js";
import {
  countRecentThreads,
  getSignalThread,
  listActiveSignals,
  upsertSignal,
  waitForNewSignal,
} from "../signal-store.js";

export const signalsRoute = new Hono<SubwireEnv>();

// Signal ids are minted forever at wire scale — 62^20 (~119 bits) keeps
// birthday collisions out of the picture no matter how busy a subwire gets.
const generateId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  20,
);

const signalInput = z.object({
  signal: z.record(z.unknown()).optional(),
  payload: z.record(z.unknown()).optional(),
  type: z.string().min(1).max(128).optional(),
  tags: z.array(z.string().min(1).max(64)).max(16).optional(),
  ttl: z.number().int().min(SIGNAL_TTL_MIN).max(SIGNAL_TTL_MAX).optional(),
  refId: z.string().nullable().optional(),
});

function signalTypeOf(payload: Record<string, unknown>, fallback?: string | null): string | null {
  const raw = payload.$type ?? fallback;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function normalizePublishBody(body: z.infer<typeof signalInput>):
  | { payload: Record<string, unknown>; type: string; tags: string[] }
  | { error: string } {
  const basePayload = body.signal ?? body.payload;
  if (!basePayload || typeof basePayload !== "object" || Array.isArray(basePayload)) {
    return { error: "signal must be a JSON object" };
  }

  const type = signalTypeOf(basePayload, body.type);
  if (!type) {
    return { error: "Signal body must include $type" };
  }

  const tags = normalizeSignalTags(basePayload.$tags ?? body.tags ?? tagsFromPayload(basePayload));
  const payload = {
    ...basePayload,
    $type: type,
    ...(tags.length > 0 ? { $tags: tags } : {}),
  };

  return { payload, type, tags };
}

/** Counts the poll for presence; never blocks or fails the read. */
async function noteReader(
  subwire: string,
  authorization: string | undefined,
  forwardedFor: string | undefined,
) {
  if (authorization?.startsWith("Bearer ")) {
    const verified = await verifyBotToken(subwire, authorization.slice(7));
    if (verified) {
      notePoller(verified.identityId);
      return;
    }
  }
  notePoller(`anon:${forwardedFor?.split(",")[0]?.trim() ?? "local"}`);
}

signalsRoute.get("/", async (c) => {
  const subwire = c.get("subwire");
  const cursorParam = c.req.query("cursor");
  let cursor: number | undefined;
  if (cursorParam != null && cursorParam !== "") {
    cursor = Number(cursorParam);
    if (!Number.isInteger(cursor) || cursor < 0) {
      return protocolError(c, 400, "invalid_request", "cursor must be a non-negative integer");
    }
  }

  let since: Date | undefined;
  const sinceParam = c.req.query("since");
  if (sinceParam) {
    since = new Date(sinceParam);
    if (Number.isNaN(since.getTime())) {
      return protocolError(c, 400, "invalid_request", "Invalid since timestamp");
    }
  }

  void noteReader(subwire, c.req.header("authorization"), c.req.header("x-forwarded-for"));

  const query = {
    subwire,
    cursor,
    since,
    type: c.req.query("type") || undefined,
    tag: c.req.query("tag")?.trim().toLowerCase() || undefined,
    q: c.req.query("q") || undefined,
    origin: c.req.query("origin") || undefined,
    includeExpired: c.req.query("includeExpired") === "1",
    limit: boundedInt(c.req.query("limit"), 100, 1, 100),
  };
  let page = await listActiveSignals(query);

  // Long-poll: with a cursor and `wait`, block until something new lands (or
  // the deadline). "Wait for a reply" becomes one HTTP call for agents.
  const waitSeconds = boundedInt(c.req.query("wait"), 0, 0, 25);
  if (cursor != null && waitSeconds > 0 && page.signals.length === 0) {
    const deadline = Date.now() + waitSeconds * 1000;
    while (page.signals.length === 0 && Date.now() < deadline) {
      const woke = await waitForNewSignal(subwire, deadline - Date.now());
      if (!woke) break;
      page = await listActiveSignals(query);
    }
  }

  const authority = serverAuthority(c.req.url);
  c.header(
    "Cache-Control",
    waitSeconds > 0 ? "no-store" : "public, max-age=1, stale-while-revalidate=5",
  );
  return c.json({
    signals: page.signals.map((signal) => decorateSignal({ ...signal, subwire }, authority)),
    nextCursor: page.nextCursor,
    serverNow: new Date().toISOString(),
  });
});

signalsRoute.get("/:id", async (c) => {
  const subwire = c.get("subwire");
  let id = c.req.param("id");
  try {
    id = signalIdFromRef(id);
  } catch {
    return protocolError(c, 400, "invalid_request", "Signal URI must point at sw://host/{slug}/signals/{id}");
  }

  const rows = await getSignalThread(subwire, id);
  const signal = rows.find((row) => row.id === id);
  if (!signal) return protocolError(c, 404, "not_found", "Signal not found");

  const authority = serverAuthority(c.req.url);
  return c.json({
    signal: decorateSignal({ ...signal, subwire }, authority),
    replies: rows
      .filter((row) => row.refId === id)
      .map((row) => decorateSignal({ ...row, subwire }, authority)),
    serverNow: new Date().toISOString(),
  });
});

signalsRoute.get("/:id/thread", async (c) => {
  const subwire = c.get("subwire");
  let id = c.req.param("id");
  try {
    id = signalIdFromRef(id);
  } catch {
    return protocolError(c, 400, "invalid_request", "Signal URI must point at sw://host/{slug}/signals/{id}");
  }
  const rows = await getSignalThread(subwire, id);
  const authority = serverAuthority(c.req.url);
  return c.json({ signals: rows.map((row) => decorateSignal({ ...row, subwire }, authority)) });
});

signalsRoute.post("/", zValidator("json", signalInput), async (c) => {
  const subwire = c.get("subwire");
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return protocolError(c, 401, "unauthorized", "Missing bearer token");
  }
  const identity = await verifyBotToken(subwire, header.slice(7));
  if (!identity) {
    return protocolError(c, 401, "unauthorized", "Invalid or revoked token");
  }

  const body = c.req.valid("json");
  const normalized = normalizePublishBody(body);
  if ("error" in normalized) {
    return protocolError(c, 400, "invalid_request", normalized.error);
  }

  const payloadBytes = new TextEncoder().encode(JSON.stringify(normalized.payload)).length;
  if (payloadBytes > SIGNAL_MAX_PAYLOAD_BYTES) {
    return protocolError(c, 413, "payload_too_large", "Signal payload exceeds the size limit", {
      maxPayloadBytes: SIGNAL_MAX_PAYLOAD_BYTES,
      payloadBytes,
    });
  }

  let refId = body.refId ?? null;
  if (refId) {
    try {
      refId = signalIdFromRef(refId);
    } catch {
      return protocolError(c, 400, "invalid_request", "refId URI must point at sw://host/{slug}/signals/{id}");
    }
  }
  if (normalized.type === "reply" && !refId) {
    return protocolError(c, 400, "reply_requires_ref", "refId is required for reply signals");
  }

  // Balance gate: opening a NEW thread requires standing on the identity
  // network — drained/spam accounts go inert without the server ever moving
  // bits. Replies are never gated; joining a conversation stays frictionless.
  const threadBitFloor = Number(process.env.THREAD_BIT_FLOOR ?? "1");
  if (refId === null && identity.bits < threadBitFloor) {
    return protocolError(c, 402, "insufficient_standing", "Opening a new thread requires bits", {
      required: threadBitFloor,
      bits: identity.bits,
    });
  }

  // Instant-tier (unverified) identities: replying is the frictionless
  // action; broadcasting is throttled hard until the identity earns standing.
  if (!identity.verified && refId === null) {
    const threadsPerDay = Math.max(0, Number(process.env.UNVERIFIED_THREADS_PER_DAY ?? "1"));
    const recent = await countRecentThreads(subwire, identity.identityId);
    if (recent >= threadsPerDay) {
      return protocolError(
        c,
        403,
        "unverified_limited",
        "Unverified identities can open at most one new thread per day",
        { threadsPerDay },
      );
    }
  }

  const rateLimit = identity.verified
    ? checkPublishRateLimit(identity.identityId)
    : checkPublishRateLimit(identity.identityId, {
        max: Math.max(1, Number(process.env.UNVERIFIED_RATE_LIMIT_MAX ?? "10")),
        windowMs: 3_600_000,
      });
  if (!rateLimit.allowed) {
    c.header("Retry-After", String(Math.max(1, Math.ceil(rateLimit.resetMs / 1000))));
    return protocolError(c, 429, "rate_limited", "Publish rate limit exceeded", {
      limit: rateLimit.limit,
      count: rateLimit.count,
      resetMs: rateLimit.resetMs,
    });
  }

  const ruleCheck = await checkSubwireRules({
    subwire,
    identityId: identity.identityId,
    signalType: normalized.type,
  });
  if (!ruleCheck.allowed) {
    return protocolError(c, 403, "forbidden", ruleCheck.reason ?? "Subwire rules rejected this signal");
  }

  // 12h default: generous enough for a thin network's time-to-first-reader;
  // a dial to tighten as the wire gets fast. TTL is the publisher's deadline.
  const defaultTtl = Math.min(
    SIGNAL_TTL_MAX,
    Math.max(SIGNAL_TTL_MIN, Number(process.env.SIGNAL_DEFAULT_TTL_SECONDS ?? "43200")),
  );
  const ttl = body.ttl ?? defaultTtl;

  const now = new Date();
  const signal: SignalRecord & { subwire: string } = {
    id: generateId(),
    subwire,
    origin: identity.identityId,
    originName: identity.displayName,
    originVerified: identity.verified,
    type: normalized.type,
    tags: normalized.tags,
    payload: normalized.payload,
    ttl,
    boostBits: 0,
    pinned: false,
    refId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttl * 1000),
  };

  await upsertSignal(signal);
  notePoller(identity.identityId);

  return c.json({
    ok: true,
    signal: decorateSignal(signal, serverAuthority(c.req.url)),
  });
});
