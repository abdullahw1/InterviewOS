/**
 * PATCH / DELETE /api/question-bank/[id]
 *
 * Edit or delete a Question_Bank entry owned by the authenticated user.
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

const PatchBody = z.object({
  questionType: z.enum(QUESTION_TYPES).optional(),
  prompt: z.string().min(1).max(5000).optional(),
  modelAnswer: z.string().min(1).max(20000).optional(),
  rubric: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  difficultyTier: z.enum(DIFFICULTY_TIERS).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function loadOwned(userId: string, id: string) {
  return prisma.questionBankEntry.findFirst({ where: { id, userId } });
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const existing = await loadOwned(user.id, id);
    if (!existing) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    const json = await req.json().catch(() => null);
    const parsed = PatchBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.issues },
        { status: 400 }
      );
    }
    const updated = await prisma.questionBankEntry.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json({ entry: updated });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('PATCH /api/question-bank/[id] error', err);
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const existing = await loadOwned(user.id, id);
    if (!existing) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    await prisma.questionBankEntry.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('DELETE /api/question-bank/[id] error', err);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
