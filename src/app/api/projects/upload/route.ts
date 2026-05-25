/**
 * POST /api/projects/upload
 *
 * Multipart upload of a `.zip` or `.tar.gz` archive that becomes a new
 * `Project` for the authenticated user.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 20.5, 20.6
 *
 * Flow:
 *   1. `requireUser` resolves the authenticated session (HTTP 401 on
 *      anonymous calls).
 *   2. The multipart body is parsed; the `file` field is required.
 *   3. The format is detected from the filename (with content-type as a
 *      fallback). Anything other than `.zip` / `.tar.gz` returns 415.
 *   4. The upload is spooled to a temp file under `os.tmpdir()` with the
 *      compressed-size cap enforced per chunk (overflow -> 413).
 *   5. A `Project` row is created in `pending` state so the on-disk
 *      directory can be keyed by `Project.id`.
 *   6. `extractArchive` streams the archive into the per-project
 *      directory under `PROJECTS_STORAGE_DIR`. It rejects entries
 *      whose resolved path escapes the directory (zip-slip) and aborts
 *      when the running uncompressed total exceeds 1 GB. Either failure
 *      causes us to delete the partial directory and the temp upload
 *      and return a structured error.
 *   7. After successful extraction we look for a single top-level
 *      directory. When found, its contents are promoted to be the
 *      Project root and its name becomes the suggested `repoName`.
 *   8. The Project's `repoName` is collision-checked against the user's
 *      existing projects and disambiguated with `-2`, `-3`, ... if
 *      needed.
 *   9. The Project row is updated to `status = 'indexing'`, the temp
 *      upload is deleted, and indexing is enqueued fire-and-forget
 *      using the same approach as the GitHub flow (task 2.1).
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  ArchiveCompressedTooLargeError,
  ArchiveCorruptError,
  ArchiveFormatError,
  ArchivePathTraversalError,
  ArchiveUncompressedTooLargeError,
  detectArchiveFormat,
  detectSingleTopLevelDir,
  deriveRepoNameFromFilename,
  extractArchive,
  resolveUniqueRepoName,
  sanitizeRepoName,
  spoolUploadToTempFile,
  MAX_COMPRESSED_BYTES,
  MAX_UNCOMPRESSED_BYTES,
} from '@/lib/services/ingest/archive';
import {
  getProjectDir,
  getProjectsStorageDir,
} from '@/lib/services/ingest/github';

// Force the Node runtime so we can use fs, tar, and yauzl. The Edge
// runtime does not support these modules.
export const runtime = 'nodejs';
// Allow the streaming body to dictate request size; Next's default 1 MB
// JSON limit doesn't apply to multipart, but we still want to make sure
// we don't buffer the whole thing.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let tempArchivePath: string | null = null;
  let extractDir: string | null = null;
  let projectId: string | null = null;

  try {
    const user = await requireUser(req);

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Expected multipart/form-data upload' },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const fileEntry = formData.get('file');
    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: 'Missing or invalid `file` field' },
        { status: 400 }
      );
    }

    // Reject before spooling when the uploaded `Content-Length` is
    // already over the cap. We still re-check per chunk because some
    // clients lie about size.
    if (fileEntry.size > MAX_COMPRESSED_BYTES) {
      return NextResponse.json(
        {
          error: `Archive exceeds the ${MAX_COMPRESSED_BYTES} byte compressed limit`,
        },
        { status: 413 }
      );
    }

    const format = detectArchiveFormat(fileEntry.name, fileEntry.type);
    if (!format) {
      return NextResponse.json(
        {
          error: 'Unsupported archive format. Use .zip or .tar.gz.',
        },
        { status: 415 }
      );
    }

    // Spool the upload to a temp file so the archive libraries can read
    // it via path-based APIs.
    try {
      tempArchivePath = await spoolUploadToTempFile(fileEntry.stream(), {
        suffix: format === 'zip' ? '.zip' : '.tar.gz',
        maxBytes: MAX_COMPRESSED_BYTES,
      });
    } catch (err) {
      if (err instanceof ArchiveCompressedTooLargeError) {
        return NextResponse.json({ error: err.message }, { status: 413 });
      }
      throw err;
    }

    // Reserve a Project row up front so the extraction directory can be
    // keyed by `Project.id` (the same convention the GitHub flow uses).
    // We use a placeholder repoName that we update once we know the
    // single-top-level-dir name, falling back to the filename.
    const provisionalName = `pending-upload-${Date.now()}`;
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        repoName: provisionalName,
        ingestionSource: 'zip',
        status: 'pending',
      },
    });
    projectId = project.id;

    // Make sure the storage root exists before extracting.
    await fs.mkdir(getProjectsStorageDir(), { recursive: true });
    extractDir = getProjectDir(project.id);
    await fs.mkdir(extractDir, { recursive: true });

    try {
      await extractArchive(tempArchivePath, extractDir, format, {
        maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
      });
    } catch (err) {
      // Best-effort cleanup of the partial extraction; the temp upload
      // is removed in `finally` below.
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
      extractDir = null;
      await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
      projectId = null;

      if (err instanceof ArchivePathTraversalError) {
        return NextResponse.json(
          { error: 'path traversal rejected', entry: err.entryName },
          { status: 422 }
        );
      }
      if (err instanceof ArchiveUncompressedTooLargeError) {
        return NextResponse.json({ error: err.message }, { status: 413 });
      }
      if (err instanceof ArchiveCorruptError) {
        return NextResponse.json({ error: err.message }, { status: 422 });
      }
      throw err;
    }

    // Single-top-level-dir collapse: when the archive was a regular
    // GitHub-style archive (one top-level directory), promote that
    // directory to be the project root so the indexer doesn't have to
    // walk through an extra `repo-1.2.3/` shim.
    const topLevelDirName = await detectSingleTopLevelDir(extractDir);
    let suggestedName: string;
    if (topLevelDirName) {
      suggestedName = sanitizeRepoName(topLevelDirName);
      try {
        await promoteSingleTopLevelDir(extractDir, topLevelDirName);
      } catch (err) {
        await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
        extractDir = null;
        await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
        projectId = null;
        if (err instanceof ArchivePathTraversalError) {
          return NextResponse.json(
            { error: 'path traversal rejected', entry: err.entryName },
            { status: 422 }
          );
        }
        throw err;
      }
    } else {
      suggestedName = '';
    }

    if (!suggestedName) {
      suggestedName = deriveRepoNameFromFilename(fileEntry.name);
    }

    const repoName = await resolveUniqueRepoName(suggestedName, async (candidate) => {
      const existing = await prisma.project.findFirst({
        where: { userId: user.id, repoName: candidate },
        select: { id: true },
      });
      // The provisional row we just inserted carries `provisionalName`,
      // which won't collide with any candidate repoName. So this lookup
      // is effectively a "does any *other* project have this name".
      return existing !== null;
    });

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        repoName,
        repoPath: extractDir,
        status: 'indexing',
        partialReason: null,
      },
    });

    enqueueIndexing(updated.id);

    return NextResponse.json(
      {
        project: {
          id: updated.id,
          repoName: updated.repoName,
          ingestionSource: updated.ingestionSource,
          status: updated.status,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    // Best-effort cleanup if we made it past directory creation but
    // failed before the success path.
    if (extractDir) {
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
    if (projectId) {
      await prisma.project
        .delete({ where: { id: projectId } })
        .catch(() => {});
    }

    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;

    if (err instanceof ArchiveFormatError) {
      return NextResponse.json({ error: err.message }, { status: 415 });
    }
    if (err instanceof ArchiveCompressedTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    console.error('POST /api/projects/upload error', err);
    return NextResponse.json({ error: 'Failed to ingest archive' }, { status: 500 });
  } finally {
    if (tempArchivePath) {
      await fs.rm(tempArchivePath, { force: true }).catch(() => {});
    }
  }
}

/**
 * After extraction, when the archive's contents lived under a single
 * top-level directory, move that directory's children up to the
 * extraction root so the indexer treats it as the project root. Each
 * source path is verified to remain inside `extractDir` for defense in
 * depth.
 */
async function promoteSingleTopLevelDir(
  extractDir: string,
  topLevelDirName: string
): Promise<void> {
  const sourceDir = path.join(extractDir, topLevelDirName);
  const sourceResolved = path.resolve(sourceDir);
  const targetResolved = path.resolve(extractDir);
  // Sanity: the source must live under the target.
  if (!sourceResolved.startsWith(targetResolved + path.sep)) {
    throw new ArchivePathTraversalError(topLevelDirName);
  }

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(extractDir, entry.name);
    // The target must be a direct child of `extractDir`.
    if (path.dirname(path.resolve(to)) !== targetResolved) {
      throw new ArchivePathTraversalError(entry.name);
    }
    await fs.rename(from, to);
  }
  await fs.rmdir(sourceDir);
}

/**
 * Fire-and-forget indexer enqueue. Mirrors the helper in the GitHub
 * route so both ingestion paths converge on the same indexing pipeline.
 * The new project-scoped indexer arrives in task 2.4; for now we use
 * the path-based indexer that's already in the codebase.
 */
function enqueueIndexing(projectId: string): void {
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
