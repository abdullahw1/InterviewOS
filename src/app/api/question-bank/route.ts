/**
 * GET / POST /api/question-bank
 *
 * Manage the authenticated user's Question_Bank entries. POST creates a
 * new entry; GET lists every entry the user owns.
 *
 * Validates: Requirements 6.1, 6.2, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';

const QUESTION_TYPES = [
  'Code_Tracing',
  'Modification',
  'Design_Rationale',
  'Debugging',
  'Tradeoffs',
  'Scaling',
  'Security',
  'Behavioral',
] as const;

const DIFFICULTY_TIERS = ['Easy', 'Medium', 'Hard', 'Staff'] as const;

const CreateBody = z.object({
  questionType: z.enum(QUESTION_TYPES),
  prompt: z.string().min(1).max(5000),
  modelAnswer: z.string().min(1).max(20000),
  rubric: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  difficultyTier: z.enum(DIFFICULTY_TIERS),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const entries = await prisma.questionBankEntry.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({ entries });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/question-bank error', err);
    return NextResponse.json({ error: 'Failed to load question bank' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const json = await req.json().catch(() => null);
    const parsed = CreateBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.issues },
        { status: 400 }
      );
    }
    const created = await prisma.questionBankEntry.create({
      data: {
        userId: user.id,
        questionType: parsed.data.questionType,
        prompt: parsed.data.prompt,
        modelAnswer: parsed.data.modelAnswer,
        rubric: parsed.data.rubric ?? null,
        tags: parsed.data.tags,
        difficultyTier: parsed.data.difficultyTier,
      },
    });
    return NextResponse.json({ entry: created }, { status: 201 });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/question-bank error', err);
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
}
