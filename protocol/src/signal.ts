export const SUBWIRE_PROTOCOL_VERSION = "1";

export const SIGNAL_TTL_MIN = 10;
export const SIGNAL_TTL_MAX = 86400;
export const SIGNAL_MAX_PAYLOAD_BYTES = 16_384;
export const SIGNAL_MAX_LIMIT = 100;
export const SIGNAL_MAX_TAGS = 16;
export const SIGNAL_MAX_TAG_LENGTH = 64;

export const KNOWN_SIGNAL_TYPES = ["broadcast", "offer", "request", "reply"] as const;
export type ProtocolSignalType = string;

export interface ProtocolSignalInput {
  type: ProtocolSignalType;
  payload: Record<string, unknown>;
  ttl: number;
  tags?: string[];
  refId?: string | null;
}

// A signal as a subwire server stores and serves it. The subwire itself is
// implicit — a server hosts exactly one — so there is no subwire field here;
// aggregator responses add `subwire: string` alongside.
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
  pinned: boolean;
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
