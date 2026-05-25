/**
 * GET /api/projects
 *
 * Lists every Project owned by the authenticated user. Backs the
 * `/projects` management UI plus the one-time migration banner.
 *
 * Validates: Requirements 5.1, 19.3, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        repoName: true,
        ingestionSource: true,
        repoPath: true,
        status: true,
        partialReason: true,
        fileCount: true,
        lastIndexedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { repoName: 'asc' },
    });

    const migrationLog = await prisma.migrationLog.findUnique({
      where: { name: 'project_drills_foundation' },
    });

    return NextResponse.json({
      projects,
      migrationBanner: migrationLog
        ? {
            createdAt: migrationLog.createdAt,
            payload: migrationLog.payload,
          }
        : null,
      isDevelopment: process.env.NODE_ENV === 'development',
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/projects error', err);
    return NextResponse.json({ error: 'Failed to load projects' }, { status: 500 });
  }
}
