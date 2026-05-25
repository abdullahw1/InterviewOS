/**
 * GET /api/drills/[id]/voice/cost
 *
 * Returns the running estimated cost for the drill. The browser polls
 * this every 10s during a call so the cost meter stays current.
 *
 * Validates: Requirements 12.4
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id: drillId } = await ctx.params;

    const drill = await prisma.drill.findUnique({
      where: { id: drillId },
      select: { userId: true, costUsd: true, createdAt: true, endedAt: true, status: true, configJson: true },
    });
    if (!drill || drill.userId !== user.id) {
      return NextResponse.json({ error: 'Drill not found' }, { status: 404 });
    }

    // Aggregate any drill-scoped cost records that landed since the row was last updated.
    const records = await prisma.costRecord.findMany({
      where: {
        feature: { in: [`voice-drill:${drillId}`, `text-drill:${drillId}`, `drill:${drillId}`] },
      },
      select: { estimatedCost: true },
    });
    const recordedCost = records.reduce((sum, r) => sum + r.estimatedCost, 0);

    // Estimate live in-call cost from elapsed wall time when call hasn't ended yet.
    const perMinuteRate = parseFloat(process.env.VAPI_PER_MINUTE_RATE ?? '0.10');
    let liveEstimate = 0;
    if (drill.status === 'in_progress') {
      const elapsedMs = Date.now() - drill.createdAt.getTime();
      const elapsedMin = elapsedMs / 60000;
      liveEstimate = elapsedMin * perMinuteRate;
    }

    const total = Math.max(drill.costUsd, recordedCost) + liveEstimate;

    return NextResponse.json({
      drillId,
      status: drill.status,
      persistedCostUsd: drill.costUsd,
      recordedCostUsd: recordedCost,
      liveEstimateUsd: liveEstimate,
      totalCostUsd: Number(total.toFixed(4)),
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/drills/[id]/voice/cost error', err);
    return NextResponse.json({ error: 'Failed to fetch cost' }, { status: 500 });
  }
}
