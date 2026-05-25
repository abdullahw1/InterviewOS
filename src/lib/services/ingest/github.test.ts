/**
 * Unit tests for `src/lib/services/ingest/github.ts`.
 *
 * Focused on the pure helpers we can exercise without mocking GitHub:
 *   - `measureDirectorySize` against a real temp directory tree.
 *   - `buildAuthorizeUrl` produces a URL with the correct scope and state.
 *   - `buildAuthenticatedCloneUrl` injects credentials safely.
 *   - `getGithubOAuthConfig` / `isGithubIngestionConfigured` env handling.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildAuthenticatedCloneUrl,
  buildAuthorizeUrl,
  generateOAuthState,
  getGithubOAuthConfig,
  GITHUB_OAUTH_SCOPES,
  isGithubIngestionConfigured,
  measureDirectorySize,
} from './github';

describe('measureDirectorySize', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'iv-size-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns 0 for an empty directory', async () => {
    expect(await measureDirectorySize(tmp)).toBe(0);
  });

  it('sums file sizes across nested subdirectories', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'hello'); // 5 bytes
    await fs.mkdir(path.join(tmp, 'sub'));
    await fs.writeFile(path.join(tmp, 'sub', 'b.txt'), 'world!'); // 6 bytes
    await fs.mkdir(path.join(tmp, 'sub', 'deeper'));
    await fs.writeFile(path.join(tmp, 'sub', 'deeper', 'c.bin'), Buffer.alloc(100)); // 100 bytes

    const total = await measureDirectorySize(tmp);
    expect(total).toBe(5 + 6 + 100);
  });

  it('does not follow symlinks', async () => {
    // Create a separate dir with a 1KB file outside `tmp` and symlink it in.
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iv-size-out-'));
    try {
      const outsideFile = path.join(outsideDir, 'big.bin');
      await fs.writeFile(outsideFile, Buffer.alloc(1024));

      await fs.writeFile(path.join(tmp, 'small.txt'), 'a'); // 1 byte
      try {
        await fs.symlink(outsideFile, path.join(tmp, 'link'));
      } catch (err) {
        // Skip the test on platforms where unprivileged users can't symlink.
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }

      const total = await measureDirectorySize(tmp);
      expect(total).toBe(1);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes client_id, scope, state, and redirect_uri', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid_abc',
      redirectUri: 'https://example.com/api/projects/github/callback',
      state: 'state_xyz',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('cid_abc');
    expect(parsed.searchParams.get('scope')).toBe(GITHUB_OAUTH_SCOPES);
    expect(parsed.searchParams.get('state')).toBe('state_xyz');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://example.com/api/projects/github/callback'
    );
  });
});

describe('buildAuthenticatedCloneUrl', () => {
  it('embeds x-access-token credentials in the clone URL', () => {
    const out = buildAuthenticatedCloneUrl(
      'https://github.com/octocat/hello-world.git',
      'ghs_secret'
    );
    expect(out).toBe('https://x-access-token:ghs_secret@github.com/octocat/hello-world.git');
  });
});

describe('generateOAuthState', () => {
  it('produces distinct base64url strings of reasonable length', () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(/^[A-Za-z0-9_-]+$/.test(a)).toBe(true);
  });
});

describe('config helpers', () => {
  const originals = {
    id: process.env.GITHUB_CLIENT_ID,
    secret: process.env.GITHUB_CLIENT_SECRET,
    encKey: process.env.GITHUB_TOKEN_ENC_KEY,
  };

  beforeEach(() => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_TOKEN_ENC_KEY;
  });

  afterEach(() => {
    process.env.GITHUB_CLIENT_ID = originals.id;
    process.env.GITHUB_CLIENT_SECRET = originals.secret;
    process.env.GITHUB_TOKEN_ENC_KEY = originals.encKey;
  });

  it('returns null when client id or secret is missing', () => {
    expect(getGithubOAuthConfig()).toBeNull();
    expect(isGithubIngestionConfigured()).toBe(false);

    process.env.GITHUB_CLIENT_ID = 'id';
    expect(getGithubOAuthConfig()).toBeNull();

    process.env.GITHUB_CLIENT_SECRET = 'secret';
    expect(getGithubOAuthConfig()).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });

  it('isGithubIngestionConfigured requires the encryption key too', () => {
    process.env.GITHUB_CLIENT_ID = 'id';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    expect(isGithubIngestionConfigured()).toBe(false);
    process.env.GITHUB_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
    expect(isGithubIngestionConfigured()).toBe(true);
  });
});
