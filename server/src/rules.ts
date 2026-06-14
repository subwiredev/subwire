import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { subwires, subwireRules } from "./db/schema.js";

export interface PublishContext {
  subwire: string;
  identityId: string;
  signalType: string;
}

interface SubwirePolicy {
  allowedSignalTypes: string[] | null;
  rules: Array<{ ruleType: "allow" | "deny"; identityId: string }>;
}

const POLICY_CACHE_TTL_MS =
  Math.max(1, Number(process.env.SUBWIRE_RULES_CACHE_TTL_SECONDS ?? "15")) * 1000;

const policyCache = new Map<string, { expiresAt: number; value: SubwirePolicy }>();

export async function getSubwirePolicy(subwire: string): Promise<SubwirePolicy> {
  const cached = policyCache.get(subwire);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [subwireRows, rules] = await Promise.all([
    db.select({ allowedSignalTypes: subwires.allowedSignalTypes }).from(subwires).where(eq(subwires.slug, subwire)),
    db
      .select({ ruleType: subwireRules.ruleType, identityId: subwireRules.identityId })
      .from(subwireRules)
      .where(eq(subwireRules.subwire, subwire)),
  ]);

  const policy: SubwirePolicy = {
    allowedSignalTypes: subwireRows[0]?.allowedSignalTypes ?? null,
    rules,
  };
  policyCache.set(subwire, { value: policy, expiresAt: Date.now() + POLICY_CACHE_TTL_MS });
  return policy;
}

export async function checkSubwireRules(
  ctx: PublishContext,
): Promise<{ allowed: boolean; reason?: string }> {
  const { allowedSignalTypes, rules } = await getSubwirePolicy(ctx.subwire);

  if (allowedSignalTypes && !allowedSignalTypes.includes(ctx.signalType)) {
    return {
      allowed: false,
      reason: `Signal type "${ctx.signalType}" is not accepted on this subwire`,
    };
  }

  const allowRules = rules.filter((r) => r.ruleType === "allow");
  if (allowRules.length > 0) {
    if (!allowRules.some((r) => r.identityId === ctx.identityId)) {
      return { allowed: false, reason: "Not authorized to publish on this subwire" };
    }
    return { allowed: true };
  }

  if (rules.some((r) => r.ruleType === "deny" && r.identityId === ctx.identityId)) {
    return { allowed: false, reason: "Blocked from publishing on this subwire" };
  }

  return { allowed: true };
}

export function invalidateSubwirePolicyCache(subwire?: string): void {
  if (subwire) policyCache.delete(subwire);
  else policyCache.clear();
}
