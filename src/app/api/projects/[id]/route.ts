/**
 * DELETE /api/projects/[id]
 *
 * Removes a Project owned by the authenticated user. Cascades to
 * `ProjectChunk`, `ProjectSummary`, `Cheatsheet`, and detaches
 * `DrillQuestion.projectId`. For zip ingestions, also removes the
 * extracted directory under `PROJECTS_STORAGE_DIR`.
 *
 * Validates: Requirements 5.4, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs/promises';

import { assertProjectsOwnedBy, httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { getProjectDir } from '@/lib/services/ingest/github';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    await assertProjectsOwnedBy(user.id, [id]);

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    await prisma.project.delete({ where: { id } });

    if (project.ingestionSource === 'zip' || project.ingestionSource === 'github') {
      try {
        await fs.rm(getProjectDir(id), { recursive: true, force: true });
      } catch (err) {
        console.warn(`failed to remove project dir for ${id}:`, err);
      }
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('DELETE /api/projects/[id] error', err);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
