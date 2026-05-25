/**
 * GET /api/projects/github/repos
 *
 * Lists the authenticated user's GitHub repositories using the access
 * token stored on `GitHubConnection`. The token is decrypted in-memory
 * for the duration of the call and is never returned to the client.
 *
 * Query params:
 *   - page (1+, default 1)
 *
 * Validates: Requirements 1.3, 1.6, 20.1, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  decryptGithubToken,
  GithubTokenInvalidError,
  isGithubIngestionConfigured,
  listAuthenticatedUserRepos,
} from '@/lib/services/ingest/github';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);

    if (!isGithubIngestionConfigured()) {
      return NextResponse.json(
        { error: 'GitHub OAuth is not configured on this server' },
        { status: 503 }
      );
    }

    const connection = await prisma.gitHubConnection.findUnique({
      where: { userId: user.id },
    });
    if (!connection || connection.status !== 'active') {
      return NextResponse.json(
        { error: 'No active GitHub connection. Please connect your account first.' },
        { status: 409 }
      );
    }

    const url = new URL(req.url);
    const pageParam = url.searchParams.get('page');
    const page = pageParam ? Math.max(1, Number(pageParam) || 1) : 1;

    const token = decryptGithubToken(connection.encryptedAccessToken as Buffer);

    try {
      const result = await listAuthenticatedUserRepos({ token, page, perPage: 30 });
      return NextResponse.json({
        page: result.page,
        perPage: result.perPage,
        hasNextPage: result.hasNextPage,
        repos: result.repos.map((r) => ({
          id: r.id,
          name: r.name,
          fullName: r.fullName,
          defaultBranch: r.defaultBranch,
          language: r.language,
          pushedAt: r.pushedAt,
          visibility: r.visibility,
          private: r.private,
        })),
      });
    } catch (err) {
      if (err instanceof GithubTokenInvalidError) {
        await prisma.gitHubConnection.update({
          where: { userId: user.id },
          data: { status: 'invalid' },
        });
        return NextResponse.json(
          { error: 'GitHub access token rejected; please reconnect.', status: 'invalid' },
          { status: 401 }
        );
      }
      throw err;
    }
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/projects/github/repos error', err);
    return NextResponse.json({ error: 'Failed to list GitHub repositories' }, { status: 500 });
  }
}
