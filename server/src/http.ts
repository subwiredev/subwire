import type { Context } from "hono";
import { protocolErrorBody } from "subwire";

export type ProtocolErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 413 | 429 | 500 | 501;

export function protocolError(
  c: Context,
  status: ProtocolErrorStatus,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return c.json(protocolErrorBody(code, message, details), status);
}

export function boundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
