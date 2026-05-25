/**
 * GET /api/projects/github/callback
 *
 * GitHub redirects here with `?code=...&state=...` after the user
 * authorizes the OAuth app. We:
 *   1. Verify the request is authenticated (requireUser).
 *   2. Validate the `state` matches the value we stashed in the
 *      `iv_gh_oauth_state` cookie (CSRF mitigation).
 *   3. Exchange the code for an access token.
 *   4. Fetch the authenticated user's GitHub login.
 *   5. Encrypt the token with `GITHUB_TOKEN_ENC_KEY` and upsert the
 *      `GitHubConnection` row for the current user.
 *   6. Redirect back to `/projects` with a success flag.
 *
 * Validates: Requirements 1.1, 1.2, 20.1, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  encryptGithubToken,
  exchangeCodeForToken,
  fetchAuthenticatedUser,
  getGithubOAuthConfig,
  getOAuthRedirectUri,
  GITHUB_OAUTH_STATE_COOKIE,
} from '@/lib/services/ingest/github';

function redirectToProjects(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/projects', req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  // Clear the one-shot state cookie on every callback exit path.
  response.cookies.set({
    name: GITHUB_OAUTH_STATE_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);

    const config = getGithubOAuthConfig();
    if (!config) {
      return NextResponse.json(
        { error: 'GitHub OAuth is not configured on this server' },
        { status: 503 }
      );
    }

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return redirectToProjects(req, {
        github: 'error',
        reason: error,
      });
    }

    if (!code || !stateParam) {
      return redirectToProjects(req, {
        github: 'error',
        reason: 'missing_code_or_state',
      });
    }

    const cookieState = req.cookies.get(GITHUB_OAUTH_STATE_COOKIE)?.value;
    if (!cookieState || cookieState !== stateParam) {
      return redirectToProjects(req, {
        github: 'error',
        reason: 'state_mismatch',
      });
    }

    const tokenResult = await exchangeCodeForToken({
      code,
      config,
      redirectUri: getOAuthRedirectUri(req.url),
    });
    const viewer = await fetchAuthenticatedUser(tokenResult.accessToken);
    // Allocate a fresh `ArrayBuffer`-backed Uint8Array to satisfy Prisma's
    // Bytes parameter type (`Uint8Array<ArrayBuffer>`). Node's Buffer can be
    // backed by SharedArrayBuffer in some configurations, which TS rejects.
    const encryptedBuffer = encryptGithubToken(tokenResult.accessToken);
    const encrypted = new Uint8Array(new ArrayBuffer(encryptedBuffer.byteLength));
    encrypted.set(encryptedBuffer);

    await prisma.gitHubConnection.upsert({
      where: { userId: user.id },
      update: {
        encryptedAccessToken: encrypted,
        scope: tokenResult.scope,
        githubLogin: viewer.login,
        status: 'active',
      },
      create: {
        userId: user.id,
        encryptedAccessToken: encrypted,
        scope: tokenResult.scope,
        githubLogin: viewer.login,
        status: 'active',
      },
    });

    return redirectToProjects(req, { github: 'connected' });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/projects/github/callback error', err);
    return redirectToProjects(req, {
      github: 'error',
      reason: 'callback_failed',
    });
  }
}
