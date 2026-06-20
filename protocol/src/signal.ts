export const SUBWIRE_PROTOCOL_VERSION = "1";

export const SIGNAL_TTL_MIN = 10;
export const SIGNAL_TTL_MAX = 86400;
export const SIGNAL_MAX_PAYLOAD_BYTES = 16_384;
export const SIGNAL_MAX_LIMIT = 100;
export const SIGNAL_MAX_TAGS = 16;
export const SIGNAL_MAX_TAG_LENGTH = 64;

export const KNOWN_SIGNAL_TYPES = ["broadcast", "offer", "request", "reply"] as const;
export type ProtocolSignalType = string;

/**
 * A publishable signal is one flat JSON object posted to `/sw/signals`.
 * Keys starting with `$` are Subwire envelope fields; every other key is the
 * caller's own payload. `$type` is required.
 *
 *   { "$type": "request", "text": "...", "$tags": ["weather"], "$ttl": 600 }
 *   { "$type": "reply",   "text": "...", "$refId": "sig_abc123" }
 *
 * The server strips `$ttl`/`$refId` (envelope controls) and stores the rest as
 * the signal's `payload` (which still carries `$type` and any `$tags`).
 */
export const SIGNAL_ENVELOPE_KEYS = ["$type", "$tags", "$ttl", "$refId"] as const;

export interface PublishSignalBody {
  /** Required. The signal type, e.g. "request" | "offer" | "reply" | "broadcast". */
  $type: ProtocolSignalType;
  /** Optional tags for filtering. */
  $tags?: string[];
  /** Optional time-to-live in seconds (10..86400). Defaults to 12h. */
  $ttl?: number;
  /** Required on replies: the signal id (or sw:// URI) being replied to. */
  $refId?: string | null;
  /** Any other keys are the caller's payload (e.g. `text`). */
  [key: string]: unknown;
}

// A signal as a subwire server stores and serves it. One server is one subwire,
// so the subwire is implicit (the server's authority); signals are organized by
// `tags`, not by any channel/address.
export interface SignalRecord {
  id: string;
  uri?: string;
  origin: string;
  originName: string | null;
  originUri?: string;
  type: ProtocolSignalType;
  tags: string[];
  payload: Record<string, unknown>;
  ttl: number;
  boostBits: number;
  /** false = published by an unverified (instant-tier) identity. */
  originVerified?: boolean;
  refId: string | null;
  refUri?: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export function normalizeSignalTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim().toLowerCase();
    if (!tag || tag.length > SIGNAL_MAX_TAG_LENGTH) continue;
    seen.add(tag);
    if (seen.size >= SIGNAL_MAX_TAGS) break;
  }
  return [...seen];
}

export function tagsFromPayload(payload: Record<string, unknown>): string[] {
  return normalizeSignalTags(payload.$tags ?? payload.tags);
}

export function isProtocolSignalType(value: string): value is ProtocolSignalType {
  return value.length > 0;
}
