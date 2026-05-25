/**
 * POST /api/drills/[id]/text/grade
 *
 * Grades a single DrillQuestion answer. Checks the cost cap before
 * calling the LLM. If the cap is exceeded, ends the drill with
 * `cost_capped` status.
 *
 * Validates: Requirements 8.2, 8.5, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  gradeAnswer,
  getDrillCost,
  isDrillCostCapped,
} from '@/lib/services/drill/question-generator';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id: drillId } = await ctx.params;

    const drill = await prisma.drill.findUnique({ where: { id: drillId } });
    if (!drill || drill.userId !== user.id) {
      return NextResponse.json({ error: 'Drill not found' }, { status: 404 });
    }

    if (drill.mode !== 'Text') {
      return NextResponse.json({ error: 'This is not a Text drill' }, { status: 400 });
    }

    const body = await req.json();
    const { questionId } = body;

    if (!questionId) {
      return NextResponse.json({ error: 'questionId is required' }, { status: 400 });
    }

    const question = await prisma.drillQuestion.findUnique({
      where: { id: questionId },
    });

    if (!question || question.drillId !== drillId) {
      return NextResponse.json({ error: 'Question not found in this drill' }, { status: 404 });
    }

    if (!question.userAnswer) {
      return NextResponse.json(
        { error: 'No answer submitted for this question yet' },
        { status: 400 }
      );
    }

    // Check cost cap before grading
    if (await isDrillCostCapped(drillId)) {
      await prisma.drill.update({
        where: { id: drillId },
        data: { status: 'cost_capped' },
      });
      return NextResponse.json({
        costCapped: true,
        message: 'Text drill cost cap reached. Drill ended.',
      });
    }

    // Grade the answer
    const result = await gradeAnswer(
      drillId,
      question.prompt,
      question.questionType,
      question.userAnswer,
      question.modelAnswer,
      question.filePaths as string[]
    );

    if (!result) {
      // Cost cap hit during grading
      await prisma.drill.update({
        where: { id: drillId },
        data: { status: 'cost_capped' },
      });
      return NextResponse.json({
        costCapped: true,
        message: 'Text drill cost cap reached during grading. Drill ended.',
      });
    }

    // Persist the grade
    await prisma.drillQuestion.update({
      where: { id: questionId },
      data: {
        score: result.score,
        feedback: result.feedback,
      },
    });

    // Update drill cost
    const totalCost = await getDrillCost(drillId);
    await prisma.drill.update({
      where: { id: drillId },
      data: { costUsd: totalCost },
    });

    return NextResponse.json({
      costCapped: false,
      score: result.score,
      feedback: result.feedback,
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('POST /api/drills/[id]/text/grade error:', msg);
    return NextResponse.json({ error: `Grading failed: ${msg}` }, { status: 500 });
  }
}
