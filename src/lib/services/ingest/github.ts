/**
 * Shared logic for GitHub-based Project ingestion.
 *
 * This module is the only place that:
 *   - Builds the GitHub OAuth authorize URL.
 *   - Exchanges an authorization code for an access token.
 *   - Encrypts/decrypts the stored access token using `GITHUB_TOKEN_ENC_KEY`.
 *   - Calls the GitHub REST API on the user's behalf.
 *   - Shallow-clones repositories into `PROJECTS_STORAGE_DIR`.
 *   - Measures the cloned repo size and rejects ones over 200 MB.
 *
 * The thin route handlers under `src/app/api/projects/github/*` import the
 * helpers here and add NextResponse / cookie plumbing.
 *
 * See `.kiro/specs/project-interview-drills/design.md`
 * (Components > `src/lib/services/ingest/github.ts`).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  decryptGithubToken,
  encryptGithubToken,
} from '@/lib/crypto';

const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

/** OAuth scopes requested. `repo` is required for cloning private repos. */
export const GITHUB_OAUTH_SCOPES = 'repo read:user';

/** Hard cap on cloned repo size before we abort (per spec Requirement 1.5). */
export const MAX_CLONED_REPO_BYTES = 200 * 1024 * 1024;

/**
 * Name of the httpOnly cookie that holds the OAuth `state` token between
 * `/start` and `/callback`. Used for CSRF mitigation.
 */
export const GITHUB_OAUTH_STATE_COOKIE = 'iv_gh_oauth_state';

export type GithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

/**
 * Resolve the OAuth client id/secret from env. Returns `null` when either
 * is missing so callers can hide the Connect GitHub button (Requirement 1.8).
 */
export function getGithubOAuthConfig(): GithubOAuthConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Whether GitHub OAuth ingestion is fully configured (client id/secret +
 * encryption key). Used by `GET /api/projects/github/status`.
 */
export function isGithubIngestionConfigured(): boolean {
  if (!getGithubOAuthConfig()) return false;
  // The encryption key must also be present so we can persist tokens.
  const key = process.env.GITHUB_TOKEN_ENC_KEY?.trim();
  return Boolean(key);
}

/**
 * Compute the public base URL of this Next.js app. We use NEXTAUTH_URL when
 * set (it is required by NextAuth in this app) and fall back to inferring
 * from the request.
 */
export function getBaseUrl(reqUrl?: string): string {
  const explicit = process.env.NEXTAUTH_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  if (reqUrl) {
    try {
      const u = new URL(reqUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  return 'http://localhost:3000';
}

/**
 * Build the redirect_uri the OAuth callback uses. Centralized so both the
 * authorize URL and the token-exchange call agree.
 */
export function getOAuthRedirectUri(reqUrl?: string): string {
  return `${getBaseUrl(reqUrl)}/api/projects/github/callback`;
}

/**
 * Build the GitHub authorize URL with `state` for CSRF protection.
 */
export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: GITHUB_OAUTH_SCOPES,
    state: args.state,
    allow_signup: 'false',
  });
  return `${GITHUB_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export type GithubAccessToken = {
  accessToken: string;
  scope: string;
  tokenType: string;
};

/**
 * Exchange an OAuth authorization code for an access token.
 */
export async function exchangeCodeForToken(args: {
  code: string;
  config: GithubOAuthConfig;
  redirectUri: string;
}): Promise<GithubAccessToken> {
  const res = await fetch(GITHUB_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: args.config.clientId,
      client_secret: args.config.clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    const reason = data.error_description || data.error || 'no access_token in response';
    throw new Error(`GitHub token exchange failed: ${reason}`);
  }
  return {
    accessToken: data.access_token,
    scope: data.scope ?? '',
    tokenType: data.token_type ?? 'bearer',
  };
}

export type GithubViewer = {
  login: string;
  id: number;
};

/**
 * Look up the authenticated user (used right after token exchange so we
 * can store `githubLogin`).
 */
export async function fetchAuthenticatedUser(token: string): Promise<GithubViewer> {
  const res = await fetch(`${GITHUB_API_URL}/user`, {
    headers: githubHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`GitHub /user failed: ${res.status}`);
  }
  const data = (await res.json()) as { login: string; id: number };
  return { login: data.login, id: data.id };
}

export type GithubRepoSummary = {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  language: string | null;
  pushedAt: string;
  visibility: string;
  cloneUrl: string;
  private: boolean;
};

/**
 * List the authenticated user's repositories, 30 per page.
 */
export async function listAuthenticatedUserRepos(args: {
  token: string;
  page?: number;
  perPage?: number;
}): Promise<{
  repos: GithubRepoSummary[];
  hasNextPage: boolean;
  page: number;
  perPage: number;
}> {
  const page = Math.max(1, args.page ?? 1);
  const perPage = Math.min(100, Math.max(1, args.perPage ?? 30));
  const url = `${GITHUB_API_URL}/user/repos?per_page=${perPage}&page=${page}&sort=pushed&affiliation=owner,collaborator`;
  const res = await fetch(url, { headers: githubHeaders(args.token) });
  if (!res.ok) {
    if (res.status === 401) {
      throw new GithubTokenInvalidError();
    }
    throw new Error(`GitHub /user/repos failed: ${res.status}`);
  }
  const data = (await res.json()) as Array<{
    id: number;
    name: string;
    full_name: string;
    default_branch: string;
    language: string | null;
    pushed_at: string;
    visibility?: string;
    private: boolean;
    clone_url: string;
  }>;
  // Detect next page from the Link header.
  const link = res.headers.get('link') ?? '';
  const hasNextPage = /rel="next"/.test(link);
  const repos: GithubRepoSummary[] = data.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    language: r.language,
    pushedAt: r.pushed_at,
    visibility: r.visibility ?? (r.private ? 'private' : 'public'),
    cloneUrl: r.clone_url,
    private: r.private,
  }));
  return { repos, hasNextPage, page, perPage };
}

/**
 * Look up a repo by numeric id. Used by `POST /api/projects/github` since
 * the UI selects repos by id.
 */
export async function getRepoById(args: {
  token: string;
  repoId: number;
}): Promise<GithubRepoSummary> {
  const res = await fetch(`${GITHUB_API_URL}/repositories/${args.repoId}`, {
    headers: githubHeaders(args.token),
  });
  if (!res.ok) {
    if (res.status === 401) throw new GithubTokenInvalidError();
    throw new Error(`GitHub /repositories/${args.repoId} failed: ${res.status}`);
  }
  const r = (await res.json()) as {
    id: number;
    name: string;
    full_name: string;
    default_branch: string;
    language: string | null;
    pushed_at: string;
    visibility?: string;
    private: boolean;
    clone_url: string;
  };
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    language: r.language,
    pushedAt: r.pushed_at,
    visibility: r.visibility ?? (r.private ? 'private' : 'public'),
    cloneUrl: r.clone_url,
    private: r.private,
  };
}

/**
 * Default storage root for cloned/extracted Project source trees.
 */
export function getProjectsStorageDir(): string {
  const explicit = process.env.PROJECTS_STORAGE_DIR?.trim();
  if (explicit) return explicit;
  return path.join(process.cwd(), '.next', 'projects');
}

/**
 * Resolve the on-disk location for a single Project. We key the directory
 * by Project.id (cuid) so concurrent ingestion of repos with the same
 * basename across different users never collides.
 */
export function getProjectDir(projectId: string): string {
  return path.join(getProjectsStorageDir(), projectId);
}

export class RepoTooLargeError extends Error {
  readonly repoName: string;
  readonly limitBytes: number;
  readonly observedBytes: number;
  constructor(repoName: string, observedBytes: number, limitBytes: number) {
    const limitMb = Math.round(limitBytes / (1024 * 1024));
    super(
      `Repository ${repoName} is ${(observedBytes / (1024 * 1024)).toFixed(1)} MB after clone, exceeds the ${limitMb} MB limit`
    );
    this.name = 'RepoTooLargeError';
    this.repoName = repoName;
    this.limitBytes = limitBytes;
    this.observedBytes = observedBytes;
  }
}

export class GithubTokenInvalidError extends Error {
  constructor(message: string = 'GitHub access token rejected; please reconnect') {
    super(message);
    this.name = 'GithubTokenInvalidError';
  }
}

/**
 * Walk a directory and sum every regular file's size. Symbolic links are
 * not followed (Requirement 3.3-style hygiene; same applies here so a
 * malicious repo can't trick us into measuring an unrelated tree).
 */
export async function measureDirectorySize(dir: string): Promise<number> {
  let total = 0;
  async function walk(current: string): Promise<void> {
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      // If the directory disappeared mid-walk, just stop counting it.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw err;
        }
      }
    }
  }
  await walk(dir);
  return total;
}

/**
 * Build a clone URL that embeds the OAuth access token so `git clone` can
 * fetch private repositories without prompting for credentials.
 */
export function buildAuthenticatedCloneUrl(cloneUrl: string, token: string): string {
  const parsed = new URL(cloneUrl);
  // GitHub's documented form: https://x-access-token:<TOKEN>@github.com/owner/repo.git
  parsed.username = 'x-access-token';
  parsed.password = token;
  return parsed.toString();
}

export type CloneRepoResult = {
  destination: string;
  sizeBytes: number;
  defaultBranch: string;
};

/**
 * Shallow-clone a GitHub repository into `destDir` using `simple-git`.
 *
 * - Uses `--depth 1 --single-branch` to keep download size small.
 * - Measures the resulting tree and aborts (deleting the dir) if it
 *   exceeds `MAX_CLONED_REPO_BYTES`. The thrown `RepoTooLargeError`
 *   carries the repo name and observed size so route handlers can return
 *   a user-friendly message naming both.
 */
export async function shallowCloneRepo(args: {
  cloneUrl: string;
  token: string;
  defaultBranch: string;
  destDir: string;
  repoName: string;
}): Promise<CloneRepoResult> {
  // Lazy import so non-clone code paths (e.g. just checking config) never
  // pull in simple-git's dependencies.
  const { simpleGit } = await import('simple-git');

  // Make sure the parent of destDir exists; remove any prior failed clone.
  await fs.mkdir(path.dirname(args.destDir), { recursive: true });
  await fs.rm(args.destDir, { recursive: true, force: true });

  const authedUrl = buildAuthenticatedCloneUrl(args.cloneUrl, args.token);
  const git = simpleGit();

  try {
    await git.clone(authedUrl, args.destDir, [
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      args.defaultBranch,
    ]);
  } catch (err) {
    // Clean up partial state and rewrap recognizable auth errors.
    await fs.rm(args.destDir, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message : String(err);
    if (/Authentication failed|fatal: could not read|Bad credentials/i.test(msg)) {
      throw new GithubTokenInvalidError(
        `Cloning ${args.repoName} failed: GitHub rejected the access token`
      );
    }
    throw err;
  }

  // Measure the cloned working tree (including .git, since the cap is on
  // disk usage we'll be holding for indexing).
  const sizeBytes = await measureDirectorySize(args.destDir);
  if (sizeBytes > MAX_CLONED_REPO_BYTES) {
    await fs.rm(args.destDir, { recursive: true, force: true });
    throw new RepoTooLargeError(args.repoName, sizeBytes, MAX_CLONED_REPO_BYTES);
  }

  return {
    destination: args.destDir,
    sizeBytes,
    defaultBranch: args.defaultBranch,
  };
}

/**
 * Build a fresh authorization `state` string. We use this as both the URL
 * `state` query param and the value of a short-lived httpOnly cookie that
 * the callback verifies. CSRF mitigation per the per-task contract.
 */
export function generateOAuthState(): string {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString(
    'base64url'
  );
}

/**
 * Re-export crypto helpers so callers don't have to import two modules.
 */
export { encryptGithubToken, decryptGithubToken };

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'InterviewOS',
  };
}
