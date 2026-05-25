/**
 * POST /api/projects/[id]/reindex
 *
 * Re-indexes a Project owned by the authenticated user. Runs
 * synchronously so the UI can show updated status on completion;
 * upstream callers can move this to a queue later.
 *
 * Validates: Requirements 5.3, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { assertProjectsOwnedBy, httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { indexProjectById } from '@/lib/services/project-indexer';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    await assertProjectsOwnedBy(user.id, [id]);

    try {
      await indexProjectById(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'indexing failed';
      await prisma.project.update({
        where: { id },
        data: { status: 'failed', partialReason: message },
      });
      return NextResponse.json({ ok: false, status: 'failed', error: message }, { status: 200 });
    }

    const refreshed = await prisma.project.findUnique({ where: { id } });
    return NextResponse.json({
      ok: true,
      status: refreshed?.status ?? 'indexed',
      fileCount: refreshed?.fileCount ?? 0,
      lastIndexedAt: refreshed?.lastIndexedAt,
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/projects/[id]/reindex error', err);
    return NextResponse.json({ error: 'Failed to re-index project' }, { status: 500 });
  }
}
