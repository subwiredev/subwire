import { logger } from "./observability.js";
import { sweepExpiredSignals } from "./signal-store.js";

const SWEEP_INTERVAL_MS =
  Math.max(5, Number(process.env.SIGNAL_SWEEP_INTERVAL_SECONDS ?? "60")) * 1000;
// Expired signals stay readable by id for the grace window (detail pages and
// origin history can still render them), then get deleted for good.
const SWEEP_GRACE_SECONDS = Math.max(0, Number(process.env.SIGNAL_SWEEP_GRACE_SECONDS ?? "86400"));

export function startExpirySweeper(): () => void {
  const timer = setInterval(async () => {
    try {
      const removed = await sweepExpiredSignals(SWEEP_GRACE_SECONDS);
      if (removed > 0) logger.debug({ removed }, "swept expired signals");
    } catch (err) {
      logger.warn({ err }, "expiry sweep failed");
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
