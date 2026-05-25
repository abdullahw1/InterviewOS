/**
 * GET /api/question-bank/export
 *
 * Canonical JSON export of every Question_Bank entry the authenticated
 * user owns. The shape matches what `POST /api/question-bank/import`
 * accepts so export -> import is a round trip (Requirement 6.4).
 *
 * Validates: Requirements 6.3, 6.4, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  type QuestionBankExportEntry,
  serializeForExport,
} from '@/lib/services/question-bank/serialize';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const rows = await prisma.questionBankEntry.findMany({
      where: { userId: user.id },
      orderBy: [{ questionType: 'asc' }, { createdAt: 'asc' }],
      select: {
        questionType: true,
        prompt: true,
        modelAnswer: true,
        rubric: true,
        tags: true,
        difficultyTier: true,
      },
    });
    const entries: QuestionBankExportEntry[] = rows.map((r) => ({
      questionType: r.questionType as QuestionBankExportEntry['questionType'],
      prompt: r.prompt,
      modelAnswer: r.modelAnswer,
      rubric: r.rubric ?? null,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      difficultyTier: r.difficultyTier as QuestionBankExportEntry['difficultyTier'],
    }));
    return new NextResponse(serializeForExport(entries), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-disposition': 'attachment; filename="question-bank.json"',
      },
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/question-bank/export error', err);
    return NextResponse.json({ error: 'Failed to export question bank' }, { status: 500 });
  }
}
