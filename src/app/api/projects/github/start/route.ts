/**
 * GET /api/projects/github/start
 *
 * Initiates the GitHub OAuth authorization-code flow. We:
 *   1. Confirm the request is authenticated (requireUser).
 *   2. Generate a random `state` token and store it in a short-lived
 *      httpOnly cookie (CSRF mitigation).
 *   3. Redirect to GitHub's authorize URL with `repo read:user` scopes.
 *
 * The matching callback handler at `/api/projects/github/callback` reads
 * the cookie, compares it to the returned `state`, and rejects the
 * request if they don't match.
 *
 * Validates: Requirements 1.1, 1.8, 20.1, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import {
  buildAuthorizeUrl,
  generateOAuthState,
  getGithubOAuthConfig,
  getOAuthRedirectUri,
  GITHUB_OAUTH_STATE_COOKIE,
} from '@/lib/services/ingest/github';

const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes is plenty for an OAuth round-trip.

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireUser(req);

    const config = getGithubOAuthConfig();
    if (!config) {
      return NextResponse.json(
        { error: 'GitHub OAuth is not configured on this server' },
        { status: 503 }
      );
    }

    const state = generateOAuthState();
    const redirectUri = getOAuthRedirectUri(req.url);
    const authorizeUrl = buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri,
      state,
    });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set({
      name: GITHUB_OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/projects/github/start error', err);
    return NextResponse.json({ error: 'Failed to start GitHub OAuth' }, { status: 500 });
  }
}
