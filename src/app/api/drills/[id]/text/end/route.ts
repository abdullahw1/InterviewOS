/**
 * POST /api/drills/[id]/text/end
 *
 * Ends a text drill, computing the overall score from graded questions.
 * Also used by the "Promote to Voice" flow to finalize the text drill.
 *
 * Validates: Requirements 8.1, 8.3
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id: drillId } = await ctx.params;

    const drill = await prisma.drill.findUnique({
      where: { id: drillId },
      include: { questions: true },
    });

    if (!drill || drill.userId !== user.id) {
      return NextResponse.json({ error: 'Drill not found' }, { status: 404 });
    }

    if (drill.mode !== 'Text') {
      return NextResponse.json({ error: 'This is not a Text drill' }, { status: 400 });
    }

    // Already ended
    if (drill.status === 'ended' || drill.status === 'cost_capped') {
      return NextResponse.json({ ok: true, status: drill.status });
    }

    // Compute overall score
    const gradedQuestions = drill.questions.filter((q) => q.score !== null);
    const overallScore =
      gradedQuestions.length > 0
        ? Math.round(
            (gradedQuestions.reduce((sum, q) => sum + (q.score ?? 0), 0) /
              gradedQuestions.length) *
              10
          ) / 10
        : null;

    await prisma.drill.update({
      where: { id: drillId },
      data: {
        status: 'ended',
        overallScore,
        endedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, status: 'ended', overallScore });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/drills/[id]/text/end error', err);
    return NextResponse.json({ error: 'Failed to end drill' }, { status: 500 });
  }
}
