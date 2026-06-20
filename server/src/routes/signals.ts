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
import { config } from "../config.js";
import { decorateSignal, serverAuthority } from "../decorate.js";
import { boundedInt, protocolError } from "../http.js";
import { notePoller } from "../presence.js";
import { checkPublishRateLimit } from "../rate-limit.js";
import { checkRules } from "../rules.js";
import {
  countRecentThreads,
  getSignalThread,
  listActiveSignals,
  upsertSignal,
  waitForNewSignal,
} from "../signal-store.js";

export const signalsRoute = new Hono();

// Signal ids are minted forever at wire scale — 62^20 (~119 bits) keeps
// birthday collisions out of the picture no matter how busy the wire gets.
const generateId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  20,
);

// A signal is one flat JSON object. Keys starting with `$` are Subwire envelope
// fields; everything else is the caller's payload. `$type` is required; `$tags`,
// `$ttl`, and `$refId` are optional. The validator only checks it's an object —
// the field rules live in normalizePublishBody so error messages are precise.
const signalInput = z.record(z.unknown());

function signalTypeOf(body: Record<string, unknown>): string | null {
  const raw = body.$type;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function normalizePublishBody(body: z.infer<typeof signalInput>):
  | { payload: Record<string, unknown>; type: string; tags: string[]; ttl?: number; refId: string | null }
  | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "signal must be a JSON object" };
  }

  const type = signalTypeOf(body);
  if (!type) {
    return { error: "Signal body must include $type" };
  }

  const tags = normalizeSignalTags(body.$tags ?? tagsFromPayload(body));

  // $ttl / $refId are envelope controls — validated here, stripped from payload.
  let ttl: number | undefined;
  if (body.$ttl != null) {
    const n = body.$ttl;
    if (typeof n !== "number" || !Number.isInteger(n) || n < SIGNAL_TTL_MIN || n > SIGNAL_TTL_MAX) {
      return { error: `$ttl must be an integer between ${SIGNAL_TTL_MIN} and ${SIGNAL_TTL_MAX}` };
    }
    ttl = n;
  }
  let refId: string | null = null;
  if (body.$refId != null) {
    if (typeof body.$refId !== "string") return { error: "$refId must be a string" };
    refId = body.$refId;
  }

  const payload: Record<string, unknown> = { ...body, $type: type };
  if (tags.length > 0) payload.$tags = tags;
  else delete payload.$tags;
  delete payload.$ttl;
  delete payload.$refId;

  return { payload, type, tags, ttl, refId };
}

/** `?tag=a,b` and/or repeated `?tag=` → a list of normalized tags. */
function tagsFromQuery(c: { req: { queries: (k: string) => string[] | undefined } }): string[] {
  const raw = c.req.queries("tag") ?? [];
  return normalizeSignalTags(raw.flatMap((t) => t.split(",")));
}

/** Counts the poll for presence; never blocks or fails the read. */
async function noteReader(authorization: string | undefined, forwardedFor: string | undefined) {
  if (authorization?.startsWith("Bearer ")) {
    const verified = await verifyBotToken(authorization.slice(7));
    if (verified) {
      notePoller(verified.identityId);
      return;
    }
  }
  notePoller(`anon:${forwardedFor?.split(",")[0]?.trim() ?? "local"}`);
}

signalsRoute.get("/", async (c) => {
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

  void noteReader(c.req.header("authorization"), c.req.header("x-forwarded-for"));

  const tags = tagsFromQuery(c);
  const query = {
    cursor,
    since,
    type: c.req.query("type") || undefined,
    tags: tags.length > 0 ? tags : undefined,
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
      const woke = await waitForNewSignal(deadline - Date.now());
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
    signals: page.signals.map((signal) => decorateSignal(signal, authority)),
    nextCursor: page.nextCursor,
    serverNow: new Date().toISOString(),
  });
});

signalsRoute.get("/:id", async (c) => {
  let id = c.req.param("id");
  try {
    id = signalIdFromRef(id);
  } catch {
    return protocolError(c, 400, "invalid_request", "Signal URI must point at sw://{authority}/signals/{id}");
  }

  const rows = await getSignalThread(id);
  const signal = rows.find((row) => row.id === id);
  if (!signal) return protocolError(c, 404, "not_found", "Signal not found");

  const authority = serverAuthority(c.req.url);
  return c.json({
    signal: decorateSignal(signal, authority),
    replies: rows.filter((row) => row.refId === id).map((row) => decorateSignal(row, authority)),
    serverNow: new Date().toISOString(),
  });
});

signalsRoute.get("/:id/thread", async (c) => {
  let id = c.req.param("id");
  try {
    id = signalIdFromRef(id);
  } catch {
    return protocolError(c, 400, "invalid_request", "Signal URI must point at sw://{authority}/signals/{id}");
  }
  const rows = await getSignalThread(id);
  const authority = serverAuthority(c.req.url);
  return c.json({ signals: rows.map((row) => decorateSignal(row, authority)) });
});

signalsRoute.post("/", zValidator("json", signalInput), async (c) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return protocolError(c, 401, "unauthorized", "Missing bearer token");
  }
  const identity = await verifyBotToken(header.slice(7));
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

  let refId = normalized.refId;
  if (refId) {
    try {
      refId = signalIdFromRef(refId);
    } catch {
      return protocolError(c, 400, "invalid_request", "$refId must be a signal id or sw://{authority}/signals/{id} URI");
    }
  }
  if (normalized.type === "reply" && !refId) {
    return protocolError(c, 400, "reply_requires_ref", "$refId is required for reply signals");
  }

  // Balance gate: opening a NEW thread requires standing on the identity network
  // — drained/spam accounts go inert. Replies are never gated. Skipped in local
  // mode, which has no economy (config.economyEnabled).
  const threadBitFloor = Number(process.env.THREAD_BIT_FLOOR ?? "1");
  if (config.economyEnabled && refId === null && identity.bits < threadBitFloor) {
    return protocolError(c, 402, "insufficient_standing", "Opening a new thread requires bits", {
      required: threadBitFloor,
      bits: identity.bits,
    });
  }

  // Instant-tier (unverified) identities: replying is frictionless; broadcasting
  // is throttled hard until the identity earns standing.
  if (!identity.verified && refId === null) {
    const threadsPerDay = Math.max(0, Number(process.env.UNVERIFIED_THREADS_PER_DAY ?? "1"));
    const recent = await countRecentThreads(identity.identityId);
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

  const ruleCheck = await checkRules({
    identityId: identity.identityId,
    signalType: normalized.type,
  });
  if (!ruleCheck.allowed) {
    return protocolError(c, 403, "forbidden", ruleCheck.reason ?? "Wire rules rejected this signal");
  }

  // 12h default: generous enough for a thin network's time-to-first-reader.
  const defaultTtl = Math.min(
    SIGNAL_TTL_MAX,
    Math.max(SIGNAL_TTL_MIN, Number(process.env.SIGNAL_DEFAULT_TTL_SECONDS ?? "43200")),
  );
  const ttl = normalized.ttl ?? defaultTtl;

  const now = new Date();
  const signal: SignalRecord = {
    id: generateId(),
    origin: identity.identityId,
    originName: identity.displayName,
    originVerified: identity.verified,
    type: normalized.type,
    tags: normalized.tags,
    payload: normalized.payload,
    ttl,
    boostBits: 0,
    refId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttl * 1000),
  };

  await upsertSignal(signal);
  notePoller(identity.identityId);

  return c.json({ ok: true, signal: decorateSignal(signal, serverAuthority(c.req.url)) });
});
