/**
 * POST /api/drills/[id]/grade
 *
 * Grades all answered DrillQuestions for the drill, computes overall score,
 * identifies weak areas, and persists all grading fields on the Drill.
 *
 * Works for both Text and Voice drills (Voice drills have a transcript but
 * the questions were generated during the voice call setup).
 *
 * Validates: Requirements 11.1–11.7
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { gradeDrill, persistGradeResult } from '@/lib/services/drill/grader';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id: drillId } = await ctx.params;

    const drill = await prisma.drill.findUnique({
      where: { id: drillId },
      include: {
        questions: {
          include: { project: { select: { repoName: true } } },
        },
      },
    });

    if (!drill || drill.userId !== user.id) {
      return NextResponse.json({ error: 'Drill not found' }, { status: 404 });
    }

    if (drill.status === 'pending' || drill.status === 'in_progress') {
      return NextResponse.json(
        { error: 'Drill must be ended before grading' },
        { status: 409 },
      );
    }

    const questions = drill.questions
      .filter((q) => q.userAnswer)
      .map((q) => ({
        id: q.id,
        questionType: q.questionType,
        prompt: q.prompt,
        userAnswer: q.userAnswer!,
        modelAnswer: q.modelAnswer,
        filePaths: Array.isArray(q.filePaths) ? (q.filePaths as string[]) : [],
        projectId: q.projectId,
      }));

    if (questions.length === 0) {
      return NextResponse.json(
        { error: 'No answered questions to grade' },
        { status: 400 },
      );
    }

    const result = await gradeDrill(drillId, questions);
    await persistGradeResult(drillId, result);

    return NextResponse.json({
      overallScore: result.overallScore,
      weakAreas: result.weakAreas,
      remediation: result.remediation,
      gradedCount: result.gradedQuestions.length,
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/drills/[id]/grade error', err);
    return NextResponse.json({ error: 'Failed to grade drill' }, { status: 500 });
  }
}
