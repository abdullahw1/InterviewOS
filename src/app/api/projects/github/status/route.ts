/**
 * GET /api/projects/github/status
 *
 * Returns whether GitHub OAuth ingestion is fully configured on the server
 * and, if so, whether the current user has an active connection. The UI
 * uses this to decide whether to show the "Connect GitHub" button and
 * whether `Settings` should display the configuration notice.
 *
 * Validates: Requirements 1.8, 20.1
 */

import { NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { isGithubIngestionConfigured } from '@/lib/services/ingest/github';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireUser();

    const configured = isGithubIngestionConfigured();

    let connection: { githubLogin: string; status: string; updatedAt: Date } | null = null;
    if (configured) {
      const row = await prisma.gitHubConnection.findUnique({
        where: { userId: user.id },
        select: { githubLogin: true, status: true, updatedAt: true },
      });
      connection = row;
    }

    return NextResponse.json({
      configured,
      connection,
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/projects/github/status error', err);
    return NextResponse.json({ error: 'Failed to load GitHub status' }, { status: 500 });
  }
}
