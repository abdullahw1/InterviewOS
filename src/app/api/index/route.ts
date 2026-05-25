/**
 * Legacy `/api/index` endpoint.
 *
 * The old behaviour treated `REPO_PATHS` as a list of "projects" and
 * indexed each parent path as a single project, which produced the
 * `all-defendai-repos` parent-folder bug. The new behaviour delegates
 * to `discoverLocalProjects()` (dev only) and `indexProjectById()`.
 *
 * Validates: Requirements 3.1 - 3.6, 4.1 - 4.8, 5.3
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { discoverLocalProjects } from '@/lib/services/local-discovery';
import { indexProjectById } from '@/lib/services/project-indexer';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);

    const discoveries = discoverLocalProjects();
    if (discoveries.length === 0) {
      return NextResponse.json(
        {
          error:
            'No repositories discovered. In development, set REPO_PATHS to a comma-separated list of parent directories.',
        },
        { status: 400 }
      );
    }

    const results: Array<{ projectId: string; repoName: string; status: string; error?: string }> = [];
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
      try {
        await indexProjectById(project.id);
        const refreshed = await prisma.project.findUnique({ where: { id: project.id } });
        results.push({
          projectId: project.id,
          repoName: project.repoName,
          status: refreshed?.status ?? 'unknown',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'indexing failed';
        await prisma.project.update({
          where: { id: project.id },
          data: { status: 'failed', partialReason: message },
        });
        results.push({
          projectId: project.id,
          repoName: project.repoName,
          status: 'failed',
          error: message,
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/index error', err);
    return NextResponse.json({ error: 'Failed to index repositories' }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        repoName: true,
        repoPath: true,
        status: true,
        fileCount: true,
        lastIndexedAt: true,
      },
      orderBy: { repoName: 'asc' },
    });
    const repos = projects.map((p) => ({
      id: p.id,
      path: p.repoPath ?? '',
      name: p.repoName,
      lastIndexed: p.lastIndexedAt,
      status: p.status,
      fileCount: p.fileCount,
    }));
    return NextResponse.json({ totalChunks: 0, repos });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/index error', err);
    return NextResponse.json({ error: 'Failed to fetch indexing status' }, { status: 500 });
  }
}
