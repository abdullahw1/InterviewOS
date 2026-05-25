/**
 * Budget_Guard
 *
 * Pre-checks whether starting a Drill would push the user past
 * `MAX_DAILY_VAPI_MINUTES` or `MAX_MONTHLY_DRILL_COST_USD`. Returns
 * `{ ok: true }` when it is safe to proceed, otherwise the offending
 * cap name and the user's current spend on that axis.
 *
 * `CostRecord` does not currently carry a `userId` column, so the
 * monthly-spend axis aggregates per-drill `feature` strings
 * (`text-drill:<id>`, `voice-drill:<id>`, `drill:<id>`) and resolves
 * those drillIds back to the user. Daily Vapi minutes are computed
 * from same-day `Voice` `Drill` rows for the user, summing actual
 * `vapiMinutes` from CostRecord when available and falling back to the
 * configured `lengthMinutes`.
 *
 * Validates: Requirements 12.2, 12.3
 */

import { prisma } from '@/lib/prisma';
import { getBudgetCaps } from '@/lib/access';

export type DrillMode = 'Text' | 'Voice';

export type PrecheckArgs = {
  userId: string;
  lengthMinutes: number;
  mode: DrillMode;
};

export type PrecheckResult =
  | { ok: true }
  | {
      ok: false;
      capName:
        | 'MAX_DAILY_VAPI_MINUTES'
        | 'MAX_MONTHLY_DRILL_COST_USD';
      currentSpend: {
        dailyVapiMinutes?: number;
        monthlyDrillCostUsd?: number;
        projectedAdditional: number;
        cap: number;
      };
    };

const DRILL_FEATURE_PREFIX = /^(text-drill|voice-drill|drill):(.+)$/;

/**
 * Sum the user's Vapi minutes consumed so far today (UTC).
 * Prefers actual `vapiMinutes` from CostRecord; falls back to drill
 * `configJson.lengthMinutes` when CostRecord rows are missing for a
 * given drill (for example, while a call is still in progress).
 */
async function getDailyVapiMinutes(userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const drills = await prisma.drill.findMany({
    where: { userId, mode: 'Voice', createdAt: { gte: start } },
    select: { id: true, configJson: true },
  });
  if (drills.length === 0) return 0;

  const features = drills.map((d) => `voice-drill:${d.id}`);
  const records = await prisma.costRecord.findMany({
    where: { feature: { in: features } },
    select: { feature: true, vapiMinutes: true },
  });

  // Map drillId -> recorded vapi minutes (sum across records).
  const recordedMinutes = new Map<string, number>();
  for (const r of records) {
    const m = r.feature.match(DRILL_FEATURE_PREFIX);
    if (!m) continue;
    const drillId = m[2];
    const minutes = r.vapiMinutes ?? 0;
    recordedMinutes.set(drillId, (recordedMinutes.get(drillId) ?? 0) + minutes);
  }

  let total = 0;
  for (const d of drills) {
    const recorded = recordedMinutes.get(d.id);
    if (recorded && recorded > 0) {
      total += recorded;
    } else {
      const cfg = d.configJson as unknown as { lengthMinutes?: number } | null;
      total += typeof cfg?.lengthMinutes === 'number' ? cfg.lengthMinutes : 0;
    }
  }
  return total;
}

/**
 * Sum the user's month-to-date drill spend (Vapi + OpenAI) by joining
 * CostRecord.feature back to Drill rows owned by the user.
 */
async function getMonthlyDrillCost(userId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  // Pull all user drills created this month plus any older drills that
  // may still be receiving cost records. Two queries kept simple:
  // 1) drills owned by the user (any status), so we can map back; 2)
  // cost records this month with drill-shaped features.
  const userDrills = await prisma.drill.findMany({
    where: { userId },
    select: { id: true },
  });
  if (userDrills.length === 0) return 0;
  const userDrillIds = new Set(userDrills.map((d) => d.id));

  const records = await prisma.costRecord.findMany({
    where: {
      createdAt: { gte: start },
      OR: [
        { feature: { startsWith: 'text-drill:' } },
        { feature: { startsWith: 'voice-drill:' } },
        { feature: { startsWith: 'drill:' } },
      ],
    },
    select: { feature: true, estimatedCost: true },
  });

  let total = 0;
  for (const r of records) {
    const m = r.feature.match(DRILL_FEATURE_PREFIX);
    if (!m) continue;
    if (userDrillIds.has(m[2])) {
      total += r.estimatedCost;
    }
  }
  return total;
}

/**
 * Pre-flight Budget_Guard check before creating a Vapi call.
 *
 * Voice drills are checked against both daily Vapi minutes and the
 * monthly drill cost cap. Text drills are not minute-bound, so only the
 * monthly cost cap applies (and is projected at 0 here — the per-drill
 * text cap is enforced inside the question generator).
 */
export async function precheckDrill(args: PrecheckArgs): Promise<PrecheckResult> {
  const caps = getBudgetCaps();
  const perMinuteRate = parseFloat(process.env.VAPI_PER_MINUTE_RATE ?? '0.10');
  const projectedCost =
    args.mode === 'Voice' ? args.lengthMinutes * perMinuteRate : 0;

  if (args.mode === 'Voice') {
    const dailyMinutes = await getDailyVapiMinutes(args.userId);
    if (dailyMinutes + args.lengthMinutes > caps.maxDailyVapiMinutes) {
      return {
        ok: false,
        capName: 'MAX_DAILY_VAPI_MINUTES',
        currentSpend: {
          dailyVapiMinutes: dailyMinutes,
          projectedAdditional: args.lengthMinutes,
          cap: caps.maxDailyVapiMinutes,
        },
      };
    }
  }

  const monthlyCost = await getMonthlyDrillCost(args.userId);
  if (monthlyCost + projectedCost > caps.maxMonthlyDrillCostUsd) {
    return {
      ok: false,
      capName: 'MAX_MONTHLY_DRILL_COST_USD',
      currentSpend: {
        monthlyDrillCostUsd: monthlyCost,
        projectedAdditional: projectedCost,
        cap: caps.maxMonthlyDrillCostUsd,
      },
    };
  }

  return { ok: true };
}
