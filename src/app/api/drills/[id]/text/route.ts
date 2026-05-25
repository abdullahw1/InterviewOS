/**
 * GET /api/drills/[id]/text — Fetch drill questions (generates if needed)
 * POST /api/drills/[id]/text — Submit an answer for a specific question
 *
 * The GET endpoint generates questions on first call and persists them.
 * Subsequent GETs return the persisted questions. The POST endpoint
 * persists the user's answer on a DrillQuestion row.
 *
 * Validates: Requirements 8.1–8.5, 20.2, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser, assertProjectsOwnedBy, getBudgetCaps } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  generateQuestions,
  getDrillCost,
  isDrillCostCapped,
  type DrillConfig,
} from '@/lib/services/drill/question-generator';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id: drillId } = await ctx.params;

    const drill = await prisma.drill.findUnique({
      where: { id: drillId },
      include: { questions: { orderBy: { createdAt: 'asc' } } },
    });

    if (!drill || drill.userId !== user.id) {
      return NextResponse.json({ error: 'Drill not found' }, { status: 404 });
    }

    if (drill.mode !== 'Text') {
      return NextResponse.json({ error: 'This is not a Text drill' }, { status: 400 });
    }

    const config = drill.configJson as unknown as DrillConfig;

    // Verify ownership of selected repos
    await assertProjectsOwnedBy(user.id, config.selectedRepos);

    // If questions already exist, return them
    if (drill.questions.length > 0) {
      return NextResponse.json({
        drill: {
          id: drill.id,
          status: drill.status,
          costUsd: drill.costUsd,
          configJson: drill.configJson,
        },
        questions: drill.questions.map((q) => ({
          id: q.id,
          questionType: q.questionType,
          prompt: q.prompt,
          modelAnswer: q.modelAnswer,
          filePaths: q.filePaths,
          userAnswer: q.userAnswer,
          score: q.score,
          feedback: q.feedback,
        })),
      });
    }

    // Check cost cap before generating
    if (await isDrillCostCapped(drillId)) {
      await prisma.drill.update({
        where: { id: drillId },
        data: { status: 'cost_capped' },
      });
      return NextResponse.json({
        drill: { id: drill.id, status: 'cost_capped', costUsd: drill.costUsd, configJson: drill.configJson },
        questions: [],
      });
    }

    // Generate questions
    await prisma.drill.update({
      where: { id: drillId },
      data: { status: 'in_progress' },
    });

    const generated = await generateQuestions(drillId, config, user.id);

    if (generated.length === 0) {
      return NextResponse.json(
        { error: 'No questions could be generated. Ensure your projects are indexed.' },
        { status: 422 }
      );
    }

    // Persist questions
    const createdQuestions = [];
    for (const q of generated) {
      const created = await prisma.drillQuestion.create({
        data: {
          drillId,
          projectId: q.projectId,
          questionType: q.questionType,
          prompt: q.prompt,
          modelAnswer: q.modelAnswer,
          filePaths: q.filePaths,
        },
      });
      createdQuestions.push(created);
    }

    // Update drill cost
    const totalCost = await getDrillCost(drillId);
    await prisma.drill.update({
      where: { id: drillId },
      data: { costUsd: totalCost },
    });

    return NextResponse.json({
      drill: {
        id: drill.id,
        status: 'in_progress',
        costUsd: totalCost,
        configJson: drill.configJson,
      },
      questions: createdQuestions.map((q) => ({
        id: q.id,
        questionType: q.questionType,
        prompt: q.prompt,
        modelAnswer: q.modelAnswer,
        filePaths: q.filePaths,
        userAnswer: q.userAnswer,
        score: q.score,
        feedback: q.feedback,
      })),
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/drills/[id]/text error', err);
    return NextResponse.json({ error: 'Failed to load text drill' }, { status: 500 });
  }
}

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
    const { questionId, userAnswer } = body;

    if (!questionId || typeof userAnswer !== 'string') {
      return NextResponse.json(
        { error: 'questionId and userAnswer are required' },
        { status: 400 }
      );
    }

    // Verify the question belongs to this drill
    const question = await prisma.drillQuestion.findUnique({
      where: { id: questionId },
    });

    if (!question || question.drillId !== drillId) {
      return NextResponse.json({ error: 'Question not found in this drill' }, { status: 404 });
    }

    // Persist the answer
    await prisma.drillQuestion.update({
      where: { id: questionId },
      data: { userAnswer },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/drills/[id]/text error', err);
    return NextResponse.json({ error: 'Failed to save answer' }, { status: 500 });
  }
}
