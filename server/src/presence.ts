/**
 * Best-effort "who is listening" approximation. With pure HTTP polling there
 * are no connections to count, so we remember who polled recently. In-memory
 * only — resets on restart, which is fine for a vanity metric.
 */
const POLLER_WINDOW_MS = 60_000;

const pollers = new Map<string, number>();

export function notePoller(key: string): void {
  pollers.set(key, Date.now());
  if (pollers.size > 10_000) prune();
}

function prune(): void {
  const cutoff = Date.now() - POLLER_WINDOW_MS;
  for (const [key, at] of pollers) {
    if (at < cutoff) pollers.delete(key);
  }
}

export function recentPollerCount(): number {
  prune();
  return pollers.size;
}

export function clearPresenceForTests(): void {
  pollers.clear();
}
