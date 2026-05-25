/**
 * POST /api/projects/github
 *
 * Body: { repoIds: number[] }
 *
 * For each selected GitHub repository:
 *   1. Look up the repo metadata by id (name, default branch, clone URL).
 *   2. Upsert a `Project` row owned by the current user with status
 *      `cloning`.
 *   3. Shallow-clone the repo into `PROJECTS_STORAGE_DIR/<projectId>`.
 *      Reject clones >200 MB with the named-size error
 *      (Requirement 1.5).
 *   4. Persist the `repoPath`, `cloneUrl`, `defaultBranch`, and flip the
 *      status to `indexing`.
 *   5. Fire-and-forget invoke the indexer. The new indexer arrives in
 *      task 2.4; for now we leave a TODO.
 *
 * Validates: Requirements 1.4, 1.5, 1.7, 20.1, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  decryptGithubToken,
  getProjectDir,
  getProjectsStorageDir,
  getRepoById,
  GithubTokenInvalidError,
  isGithubIngestionConfigured,
  RepoTooLargeError,
  shallowCloneRepo,
} from '@/lib/services/ingest/github';
import * as fs from 'node:fs/promises';

const BodySchema = z.object({
  repoIds: z.array(z.number().int().positive()).min(1).max(50),
});

type RegistrationOutcome =
  | { ok: true; projectId: string; repoName: string; sizeBytes: number }
  | { ok: false; repoId: number; repoName?: string; error: string };

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);

    if (!isGithubIngestionConfigured()) {
      return NextResponse.json(
        { error: 'GitHub OAuth is not configured on this server' },
        { status: 503 }
      );
    }

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { repoIds } = parsed.data;
    const uniqueRepoIds = Array.from(new Set(repoIds));

    const connection = await prisma.gitHubConnection.findUnique({
      where: { userId: user.id },
    });
    if (!connection || connection.status !== 'active') {
      return NextResponse.json(
        { error: 'No active GitHub connection. Please connect your account first.' },
        { status: 409 }
      );
    }

    const token = decryptGithubToken(connection.encryptedAccessToken as Buffer);

    // Make sure the storage dir exists before any clone.
    await fs.mkdir(getProjectsStorageDir(), { recursive: true });

    const outcomes: RegistrationOutcome[] = [];
    let tokenInvalidated = false;

    for (const repoId of uniqueRepoIds) {
      if (tokenInvalidated) {
        outcomes.push({
          ok: false,
          repoId,
          error: 'GitHub access token rejected; please reconnect.',
        });
        continue;
      }
      try {
        const repo = await getRepoById({ token, repoId });

        // Upsert a Project row in `cloning` state. We key by (userId, repoName)
        // since that's the unique constraint on the table; subsequent
        // re-clones reuse the same projectId.
        const project = await prisma.project.upsert({
          where: {
            userId_repoName: { userId: user.id, repoName: repo.name },
          },
          update: {
            ingestionSource: 'github',
            status: 'cloning',
            cloneUrl: repo.cloneUrl,
            defaultBranch: repo.defaultBranch,
            partialReason: null,
          },
          create: {
            userId: user.id,
            repoName: repo.name,
            ingestionSource: 'github',
            status: 'cloning',
            cloneUrl: repo.cloneUrl,
            defaultBranch: repo.defaultBranch,
          },
        });

        const destDir = getProjectDir(project.id);

        try {
          const cloneResult = await shallowCloneRepo({
            cloneUrl: repo.cloneUrl,
            token,
            defaultBranch: repo.defaultBranch,
            destDir,
            repoName: repo.name,
          });

          await prisma.project.update({
            where: { id: project.id },
            data: {
              repoPath: cloneResult.destination,
              status: 'indexing',
              partialReason: null,
            },
          });

          outcomes.push({
            ok: true,
            projectId: project.id,
            repoName: repo.name,
            sizeBytes: cloneResult.sizeBytes,
          });

          // TODO(task-2.4): replace this with `indexProject(project.id)` from
          // the rewritten project-scoped indexer. For now we leave the
          // Project in `indexing` status and rely on the manual /projects
          // re-index UI to do the actual work.
          // Fire-and-forget intentionally has no awaiter.
          enqueueIndexing(project.id);
        } catch (err) {
          // Mark the Project failed and propagate a structured outcome.
          if (err instanceof RepoTooLargeError) {
            await prisma.project.update({
              where: { id: project.id },
              data: {
                status: 'failed',
                partialReason: err.message,
              },
            });
            outcomes.push({
              ok: false,
              repoId,
              repoName: repo.name,
              error: err.message,
            });
            continue;
          }
          if (err instanceof GithubTokenInvalidError) {
            await prisma.project.update({
              where: { id: project.id },
              data: { status: 'failed', partialReason: err.message },
            });
            await prisma.gitHubConnection.update({
              where: { userId: user.id },
              data: { status: 'invalid' },
            });
            tokenInvalidated = true;
            outcomes.push({
              ok: false,
              repoId,
              repoName: repo.name,
              error: 'GitHub access token rejected; please reconnect.',
            });
            continue;
          }
          const message = err instanceof Error ? err.message : 'Clone failed';
          await prisma.project.update({
            where: { id: project.id },
            data: { status: 'failed', partialReason: message },
          });
          outcomes.push({ ok: false, repoId, repoName: repo.name, error: message });
        }
      } catch (err) {
        if (err instanceof GithubTokenInvalidError) {
          await prisma.gitHubConnection.update({
            where: { userId: user.id },
            data: { status: 'invalid' },
          });
          tokenInvalidated = true;
          outcomes.push({
            ok: false,
            repoId,
            error: 'GitHub access token rejected; please reconnect.',
          });
          continue;
        }
        const message = err instanceof Error ? err.message : 'Failed to register repo';
        outcomes.push({ ok: false, repoId, error: message });
      }
    }

    const ok = outcomes.filter((o): o is Extract<RegistrationOutcome, { ok: true }> => o.ok);
    const failed = outcomes.filter((o): o is Extract<RegistrationOutcome, { ok: false }> => !o.ok);

    return NextResponse.json(
      {
        registered: ok,
        failed,
      },
      { status: failed.length === 0 ? 201 : 207 }
    );
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/projects/github error', err);
    return NextResponse.json({ error: 'Failed to register GitHub repositories' }, { status: 500 });
  }
}

/**
 * Enqueue indexing for a freshly cloned Project. The project-scoped
 * indexer is being rewritten in task 2.4; until that lands we keep the
 * existing path-based indexer wired up so that ingestion + re-index in
 * /projects continues to produce a Project_Summary and File_Index.
 *
 * The call is fire-and-forget — we do not await it inside the request
 * handler so the user gets a fast response. Errors are logged and the
 * Project row is marked as `failed` so the UI can show a Retry action.
 */
function enqueueIndexing(projectId: string): void {
  // Lazy import to avoid pulling the OpenAI client into request paths
  // that don't need it.
  void (async () => {
    try {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project || !project.repoPath) return;
      const { indexProject } = await import('@/lib/services/project-indexer');
      await indexProject(project.repoPath);
      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'indexed',
          lastIndexedAt: new Date(),
        },
      });
    } catch (err) {
      console.error(`Indexing failed for project ${projectId}:`, err);
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
