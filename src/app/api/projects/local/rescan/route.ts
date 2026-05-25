/**
 * POST /api/projects/local/rescan
 *
 * Dev-only. Walks `REPO_PATHS` (when `NODE_ENV === 'development'`) and
 * upserts one `Project` row per discovered repository, then enqueues
 * indexing for each. Returns `[]` and a 200 in production so the UI can
 * call this safely.
 *
 * Validates: Requirements 3.1 - 3.6, 5.2
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { discoverLocalProjects } from '@/lib/services/local-discovery';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);

    const discoveries = discoverLocalProjects();

    const upserted: Array<{ projectId: string; repoName: string; repoPath: string }> = [];

    for (const d of discoveries) {
      const project = await prisma.project.upsert({
        where: { userId_repoName: { userId: user.id, repoName: d.repoName } },
        update: {
          ingestionSource: 'local_path',
          repoPath: d.repoPath,
          status: 'indexing',
          partialReason: null,
        },
        create: {
          userId: user.id,
          repoName: d.repoName,
          ingestionSource: 'local_path',
          repoPath: d.repoPath,
          status: 'indexing',
        },
      });
      upserted.push({
        projectId: project.id,
        repoName: project.repoName,
        repoPath: d.repoPath,
      });
      // Fire-and-forget indexing.
      void enqueueIndexing(project.id);
    }

    return NextResponse.json({ discovered: upserted.length, projects: upserted });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/projects/local/rescan error', err);
    return NextResponse.json({ error: 'Failed to rescan local paths' }, { status: 500 });
  }
}

function enqueueIndexing(projectId: string): void {
  void (async () => {
    try {
      const { indexProjectById } = await import('@/lib/services/project-indexer');
      await indexProjectById(projectId);
    } catch (err) {
      console.error(`Local rescan indexing failed for ${projectId}:`, err);
      await prisma.project
        .update({
          where: { id: projectId },
          data: {
            status: 'failed',
            partialReason: err instanceof Error ? err.message : 'indexing failed',
          },
        })
        .catch(() => {});
    }
  })();
}
