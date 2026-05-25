/**
 * Shared logic for archive-based Project ingestion (zip / tar.gz).
 *
 * This module is the only place that:
 *   - Detects the archive format from the filename + content-type.
 *   - Streams a zip or tar.gz into a per-Project extraction directory.
 *   - Enforces the compressed-size cap (200 MB) and the running
 *     uncompressed-size cap (1 GB).
 *   - Verifies every archive entry resolves to a path inside the
 *     extraction directory (zip-slip prevention).
 *   - Detects when an archive has a single top-level directory so the
 *     route handler can promote that directory's contents to be the
 *     Project root and propose its name as the suggested `repoName`.
 *
 * Helpers (`isPathInsideDirectory`, `detectArchiveFormat`,
 * `detectSingleTopLevelDir`, `sanitizeRepoName`,
 * `deriveRepoNameFromFilename`) are exported so they can be exercised
 * by the unit tests in `archive.test.ts` and by the zip-slip property
 * test added in task 2.6.
 *
 * See `.kiro/specs/project-interview-drills/design.md`
 * (Components > Server modules > `src/lib/services/ingest/archive.ts`).
 */

import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

import yauzl from 'yauzl';
import * as tar from 'tar';

/** Hard cap on the compressed archive size (Requirement 2.1). */
export const MAX_COMPRESSED_BYTES = 200 * 1024 * 1024;

/** Hard cap on the running uncompressed total during extraction (Requirement 2.1). */
export const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

export type ArchiveFormat = 'zip' | 'tar.gz';

/**
 * Errors thrown by this module. Route handlers map them to HTTP status
 * codes:
 *   - `ArchiveFormatError` -> 415
 *   - `ArchiveCompressedTooLargeError` -> 413
 *   - `ArchiveUncompressedTooLargeError` -> 413
 *   - `ArchivePathTraversalError` -> 422
 *   - `ArchiveCorruptError` -> 422
 */
export class ArchiveFormatError extends Error {
  constructor(message = 'unsupported archive format') {
    super(message);
    this.name = 'ArchiveFormatError';
  }
}

export class ArchiveCompressedTooLargeError extends Error {
  readonly limitBytes = MAX_COMPRESSED_BYTES;
  constructor(message = `compressed archive exceeds ${MAX_COMPRESSED_BYTES} byte limit`) {
    super(message);
    this.name = 'ArchiveCompressedTooLargeError';
  }
}

export class ArchiveUncompressedTooLargeError extends Error {
  readonly limitBytes = MAX_UNCOMPRESSED_BYTES;
  constructor(message = `uncompressed archive exceeds ${MAX_UNCOMPRESSED_BYTES} byte limit`) {
    super(message);
    this.name = 'ArchiveUncompressedTooLargeError';
  }
}

export class ArchivePathTraversalError extends Error {
  readonly entryName: string;
  constructor(entryName: string) {
    super(`path traversal rejected: ${entryName}`);
    this.name = 'ArchivePathTraversalError';
    this.entryName = entryName;
  }
}

export class ArchiveCorruptError extends Error {
  constructor(message = 'archive is corrupt or unreadable') {
    super(message);
    this.name = 'ArchiveCorruptError';
  }
}

/**
 * Detect the archive format from the upload filename and (optionally)
 * the multipart content-type. Returns `null` when neither matches a
 * supported format so the caller can return HTTP 415.
 */
export function detectArchiveFormat(
  filename: string,
  contentType?: string | null
): ArchiveFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';

  const ct = (contentType ?? '').toLowerCase().split(';')[0].trim();
  if (ct === 'application/zip' || ct === 'application/x-zip-compressed') return 'zip';
  if (
    ct === 'application/gzip' ||
    ct === 'application/x-gzip' ||
    ct === 'application/x-tar+gzip' ||
    ct === 'application/x-compressed-tar'
  ) {
    return 'tar.gz';
  }
  return null;
}

/**
 * Return true when `child` is `parent` or a strict descendant of
 * `parent`. Both paths are resolved to absolute form before comparison
 * so callers don't need to pre-normalize.
 *
 * This is the zip-slip safety check used by both extractors and is the
 * helper exercised by the property test in task 2.6.
 */
export function isPathInsideDirectory(parent: string, child: string): boolean {
  const parentNorm = path.resolve(parent);
  const childNorm = path.resolve(child);
  if (childNorm === parentNorm) return true;
  return childNorm.startsWith(parentNorm + path.sep);
}

/**
 * Sanitize a string so it is safe to use as a `Project.repoName`:
 *   - Trim leading/trailing whitespace.
 *   - Drop control characters.
 *   - Replace path separators with underscores so the name can never
 *     reference a different on-disk location.
 *   - Strip leading dots so the name doesn't look like a hidden file.
 *   - Cap the length at 100 characters (the column has no length
 *     constraint but values much longer than this are unwieldy in the
 *     UI).
 *
 * Returns an empty string when the cleaned name would be empty; callers
 * are expected to fall back to a default name in that case.
 */
export function sanitizeRepoName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = raw.trim().replace(/[\x00-\x1f]/g, '').replace(/[\\/]/g, '_');
  return stripped.replace(/^\.+/, '').slice(0, 100);
}

/**
 * Strip the archive extension from an upload filename and sanitize the
 * remainder so it can serve as the suggested `Project.repoName` when
 * the archive does not contain a single top-level directory.
 */
export function deriveRepoNameFromFilename(filename: string): string {
  const base = path.basename(filename);
  const lower = base.toLowerCase();
  let stripped = base;
  if (lower.endsWith('.tar.gz')) stripped = base.slice(0, -7);
  else if (lower.endsWith('.tgz')) stripped = base.slice(0, -4);
  else if (lower.endsWith('.zip')) stripped = base.slice(0, -4);
  const cleaned = sanitizeRepoName(stripped);
  return cleaned || 'upload';
}

/**
 * After extraction, list the immediate children of `dir`. When the
 * archive contained exactly one top-level entry and that entry is a
 * directory (and no files exist at the root), return that directory's
 * name. Otherwise return `null`.
 *
 * Hidden entries (e.g. `.gitignore`) count as files; they prevent
 * collapse so we don't promote a directory whose contents would shadow
 * dotfiles that lived alongside it in the archive.
 */
export async function detectSingleTopLevelDir(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.length !== 1) return null;
  const sole = entries[0];
  if (!sole.isDirectory()) return null;
  return sole.name;
}

export type ExtractResult = {
  /** Number of entries written (excluding skipped directories). */
  entryCount: number;
  /** Running uncompressed byte total observed during extraction. */
  uncompressedBytes: number;
};

export type ExtractOptions = {
  /** Override the per-archive uncompressed cap; defaults to 1 GB. */
  maxUncompressedBytes?: number;
};

/**
 * Stream-extract `archivePath` into `extractDir`. The directory is
 * created if it doesn't exist and is left as-is (containing whatever
 * was extracted) on success. On any failure the caller is expected to
 * `rm -rf extractDir` to clean up partials.
 *
 * Every entry's resolved path is checked against `extractDir`. The
 * running uncompressed byte total is checked against the configured
 * cap. Either violation aborts extraction immediately and bubbles a
 * typed error.
 */
export async function extractArchive(
  archivePath: string,
  extractDir: string,
  format: ArchiveFormat,
  options: ExtractOptions = {}
): Promise<ExtractResult> {
  const maxUncompressed = options.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  await fs.mkdir(extractDir, { recursive: true });
  if (format === 'zip') {
    return extractZip(archivePath, extractDir, maxUncompressed);
  }
  return extractTarGz(archivePath, extractDir, maxUncompressed);
}

async function extractZip(
  archivePath: string,
  extractDir: string,
  maxUncompressed: number
): Promise<ExtractResult> {
  const zipFile = await openZip(archivePath);

  let entryCount = 0;
  let uncompressedBytes = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: unknown) => {
        if (settled) return;
        settled = true;
        zipFile.removeAllListeners();
        if (err) reject(err);
        else resolve();
      };

      zipFile.on('error', settle);
      zipFile.on('end', () => settle());

      zipFile.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          try {
            const fileName = entry.fileName;

            if (fileName.includes('\x00')) {
              throw new ArchivePathTraversalError(fileName);
            }
            const resolved = path.resolve(extractDir, fileName);
            if (!isPathInsideDirectory(extractDir, resolved)) {
              throw new ArchivePathTraversalError(fileName);
            }

            const isDirEntry = /\/$/.test(fileName);
            if (isDirEntry) {
              await fs.mkdir(resolved, { recursive: true });
              zipFile.readEntry();
              return;
            }

            await fs.mkdir(path.dirname(resolved), { recursive: true });

            const readStream = await openZipReadStream(zipFile, entry);
            const writeStream = createWriteStream(resolved);

            // Transform that counts bytes and trips the global cap so
            // the pipeline aborts before writing more than the budget.
            const counter = new Transform({
              transform(chunk: Buffer, _enc, cb) {
                uncompressedBytes += chunk.length;
                if (uncompressedBytes > maxUncompressed) {
                  cb(new ArchiveUncompressedTooLargeError());
                  return;
                }
                cb(null, chunk);
              },
            });

            await pipeline(readStream, counter, writeStream);

            entryCount += 1;
            zipFile.readEntry();
          } catch (err) {
            settle(err);
          }
        })();
      });

      zipFile.readEntry();
    });
  } finally {
    try {
      zipFile.close();
    } catch {
      /* already closed */
    }
  }

  return { entryCount, uncompressedBytes };
}

async function extractTarGz(
  archivePath: string,
  extractDir: string,
  maxUncompressed: number
): Promise<ExtractResult> {
  let entryCount = 0;
  let uncompressedBytes = 0;
  // tar's `filter` and `onReadEntry` callbacks are called synchronously by
  // the unpack stream but throwing from them surfaces as an uncaught
  // exception rather than rejecting `tar.x`'s promise. We instead
  // capture the first violation in a closure variable, return false /
  // bail out of the callbacks, and rethrow it after `tar.x` settles so
  // the caller still sees a typed error and the promise resolves
  // cleanly.
  let abortError: Error | null = null;

  try {
    await tar.x({
      file: archivePath,
      cwd: extractDir,
      strict: true,
      // preservePaths: false (default) already strips absolute paths and
      // rejects entries that would escape `cwd`. We add our own resolved-
      // path check for defense in depth and a per-entry size accumulator.
      preservePaths: false,
      filter: (entryPath: string) => {
        if (abortError) return false;
        if (entryPath.includes('\x00')) {
          abortError = new ArchivePathTraversalError(entryPath);
          return false;
        }
        const resolved = path.resolve(extractDir, entryPath);
        if (!isPathInsideDirectory(extractDir, resolved)) {
          abortError = new ArchivePathTraversalError(entryPath);
          return false;
        }
        return true;
      },
      onReadEntry: (entry) => {
        if (abortError) return;
        entryCount += 1;
        const size = (entry as { size?: number }).size;
        if (typeof size === 'number' && size > 0) {
          uncompressedBytes += size;
          if (uncompressedBytes > maxUncompressed) {
            abortError = new ArchiveUncompressedTooLargeError();
          }
        }
      },
    });
  } catch (err) {
    if (
      err instanceof ArchivePathTraversalError ||
      err instanceof ArchiveUncompressedTooLargeError
    ) {
      throw err;
    }
    if (err instanceof Error && /TAR_/.test(err.message)) {
      throw new ArchiveCorruptError(err.message);
    }
    throw err;
  }

  if (abortError) {
    throw abortError;
  }

  return { entryCount, uncompressedBytes };
}

function openZip(archivePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zipFile) => {
      if (err) {
        reject(new ArchiveCorruptError(err.message));
        return;
      }
      if (!zipFile) {
        reject(new ArchiveCorruptError('zip file handle missing'));
        return;
      }
      resolve(zipFile);
    });
  });
}

function openZipReadStream(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry
): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err) {
        reject(new ArchiveCorruptError(err.message));
        return;
      }
      if (!stream) {
        reject(new ArchiveCorruptError('zip read stream missing'));
        return;
      }
      resolve(stream);
    });
  });
}

/**
 * Stream a Web `ReadableStream` (the body of an uploaded `File`) onto
 * disk, enforcing `maxBytes` so a malicious upload cannot exhaust the
 * server. Returns the path to the temp file on success and throws
 * `ArchiveCompressedTooLargeError` on overflow.
 *
 * The temp file is always created under `os.tmpdir()` to avoid
 * polluting `PROJECTS_STORAGE_DIR` with half-uploaded archives, and is
 * the route handler's responsibility to delete after extraction.
 */
export async function spoolUploadToTempFile(
  source: ReadableStream<Uint8Array> | Buffer,
  options: { suffix?: string; maxBytes?: number } = {}
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_COMPRESSED_BYTES;
  const suffix = options.suffix ?? '';
  const tempPath = path.join(
    os.tmpdir(),
    `iv-archive-${crypto.randomUUID()}${suffix}`
  );

  if (Buffer.isBuffer(source)) {
    if (source.byteLength > maxBytes) {
      throw new ArchiveCompressedTooLargeError();
    }
    await fs.writeFile(tempPath, source);
    return tempPath;
  }

  const reader = source.getReader();
  const writer = createWriteStream(tempPath);
  let written = 0;
  try {
    // We could call pipeline(Readable.fromWeb(source), writer) and check
    // size after, but enforcing per-chunk lets us bail before we've
    // committed gigabytes to disk.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      written += value.byteLength;
      if (written > maxBytes) {
        throw new ArchiveCompressedTooLargeError();
      }
      await new Promise<void>((resolve, reject) => {
        writer.write(value, (err) => (err ? reject(err) : resolve()));
      });
    }
    await new Promise<void>((resolve, reject) => {
      writer.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    writer.destroy();
    await fs.rm(tempPath, { force: true });
    throw err;
  }
  return tempPath;
}

/**
 * Resolve a unique `repoName` for the given user, appending `-2`,
 * `-3`, ... until it does not collide with any existing
 * `Project.repoName` for that user. The lookup is delegated to a
 * caller-supplied function so this helper stays free of Prisma
 * imports (and thus stays cheap to test in isolation).
 */
export async function resolveUniqueRepoName(
  baseName: string,
  isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const seed = baseName.length === 0 ? 'upload' : baseName;
  if (!(await isTaken(seed))) return seed;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${seed}-${i}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`could not find a unique repo name from base ${seed}`);
}

/**
 * Convenience: copy a Web `ReadableStream` (e.g. `File.stream()`) to a
 * Node `Readable` for callers that prefer the classic stream API.
 * Currently only used by tests; left exported for future reuse.
 */
export function readableFromWeb(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]);
}
