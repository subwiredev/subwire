import { db } from "./db/client.js";
import { rules, wire } from "./db/schema.js";

export interface PublishContext {
  identityId: string;
  signalType: string;
}

interface WirePolicy {
  allowedSignalTypes: string[] | null;
  rules: Array<{ ruleType: "allow" | "deny"; identityId: string }>;
}

const POLICY_CACHE_TTL_MS =
  Math.max(1, Number(process.env.SUBWIRE_RULES_CACHE_TTL_SECONDS ?? "15")) * 1000;

let policyCache: { expiresAt: number; value: WirePolicy } | null = null;

export async function getWirePolicy(): Promise<WirePolicy> {
  if (policyCache && policyCache.expiresAt > Date.now()) return policyCache.value;

  const [wireRows, ruleRows] = await Promise.all([
    db.select({ allowedSignalTypes: wire.allowedSignalTypes }).from(wire),
    db.select({ ruleType: rules.ruleType, identityId: rules.identityId }).from(rules).orderBy(rules.id),
  ]);

  const value: WirePolicy = {
    allowedSignalTypes: wireRows[0]?.allowedSignalTypes ?? null,
    rules: ruleRows,
  };
  policyCache = { value, expiresAt: Date.now() + POLICY_CACHE_TTL_MS };
  return value;
}

export async function checkRules(ctx: PublishContext): Promise<{ allowed: boolean; reason?: string }> {
  const { allowedSignalTypes, rules: ruleList } = await getWirePolicy();

  if (allowedSignalTypes && !allowedSignalTypes.includes(ctx.signalType)) {
    return { allowed: false, reason: `Signal type "${ctx.signalType}" is not accepted on this wire` };
  }

  const allowRules = ruleList.filter((r) => r.ruleType === "allow");
  if (allowRules.length > 0) {
    if (!allowRules.some((r) => r.identityId === ctx.identityId)) {
      return { allowed: false, reason: "Not authorized to publish on this wire" };
    }
    return { allowed: true };
  }

  if (ruleList.some((r) => r.ruleType === "deny" && r.identityId === ctx.identityId)) {
    return { allowed: false, reason: "Blocked from publishing on this wire" };
  }

  return { allowed: true };
}

export function invalidateWirePolicyCache(): void {
  policyCache = null;
}
