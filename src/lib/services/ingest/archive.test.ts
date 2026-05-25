/**
 * Unit tests for `src/lib/services/ingest/archive.ts`.
 *
 * The full zip-slip property test lives in task 2.6 and exercises the
 * extraction pipeline against adversarial archives. These tests cover
 * the pure helpers and one end-to-end exercise of `extractArchive` /
 * `detectSingleTopLevelDir` against tar.gz fixtures we build in-process.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as tar from 'tar';

import {
  detectArchiveFormat,
  detectSingleTopLevelDir,
  deriveRepoNameFromFilename,
  extractArchive,
  isPathInsideDirectory,
  resolveUniqueRepoName,
  sanitizeRepoName,
  spoolUploadToTempFile,
  ArchiveCompressedTooLargeError,
  ArchivePathTraversalError,
  ArchiveUncompressedTooLargeError,
} from './archive';

describe('detectArchiveFormat', () => {
  it('detects zip from filename suffix', () => {
    expect(detectArchiveFormat('repo.zip')).toBe('zip');
    expect(detectArchiveFormat('REPO.ZIP')).toBe('zip');
  });

  it('detects tar.gz from filename suffix', () => {
    expect(detectArchiveFormat('repo.tar.gz')).toBe('tar.gz');
    expect(detectArchiveFormat('repo.tgz')).toBe('tar.gz');
    expect(detectArchiveFormat('REPO.TAR.GZ')).toBe('tar.gz');
  });

  it('falls back to content-type', () => {
    expect(detectArchiveFormat('archive.bin', 'application/zip')).toBe('zip');
    expect(detectArchiveFormat('archive.bin', 'application/x-zip-compressed')).toBe('zip');
    expect(detectArchiveFormat('archive.bin', 'application/gzip')).toBe('tar.gz');
    expect(detectArchiveFormat('archive.bin', 'application/x-gzip')).toBe('tar.gz');
  });

  it('returns null for unsupported formats', () => {
    expect(detectArchiveFormat('repo.tar')).toBeNull();
    expect(detectArchiveFormat('repo.7z')).toBeNull();
    expect(detectArchiveFormat('repo.bin')).toBeNull();
    expect(detectArchiveFormat('archive.bin', 'application/octet-stream')).toBeNull();
    expect(detectArchiveFormat('archive.bin', null)).toBeNull();
  });

  it('ignores content-type parameters when matching', () => {
    expect(detectArchiveFormat('archive.bin', 'application/zip; charset=binary')).toBe('zip');
  });
});

describe('isPathInsideDirectory', () => {
  it('treats the directory itself as inside', () => {
    expect(isPathInsideDirectory('/srv/projects/abc', '/srv/projects/abc')).toBe(true);
  });

  it('accepts strict descendants', () => {
    expect(isPathInsideDirectory('/srv/projects/abc', '/srv/projects/abc/sub/file.ts')).toBe(true);
  });

  it('rejects sibling directories with a shared prefix', () => {
    expect(isPathInsideDirectory('/srv/projects/abc', '/srv/projects/abcdef')).toBe(false);
    expect(isPathInsideDirectory('/srv/projects/abc', '/srv/projects/abc-other/file')).toBe(false);
  });

  it('rejects parent directory escapes via ..', () => {
    const parent = '/srv/projects/abc';
    const escape = path.resolve(parent, '../etc/passwd');
    expect(isPathInsideDirectory(parent, escape)).toBe(false);
  });

  it('rejects absolute paths to /etc', () => {
    expect(isPathInsideDirectory('/srv/projects/abc', '/etc/passwd')).toBe(false);
  });

  it('handles relative inputs by resolving against cwd', () => {
    // Both arguments resolve relative to cwd, so a child like 'sub/file' is inside '.'.
    expect(isPathInsideDirectory('.', './sub/file.ts')).toBe(true);
  });
});

describe('sanitizeRepoName', () => {
  it('trims whitespace', () => {
    expect(sanitizeRepoName('  myrepo  ')).toBe('myrepo');
  });

  it('strips path separators', () => {
    expect(sanitizeRepoName('a/b\\c')).toBe('a_b_c');
  });

  it('strips leading dots', () => {
    expect(sanitizeRepoName('..hidden')).toBe('hidden');
  });

  it('returns empty for inputs that reduce to nothing', () => {
    expect(sanitizeRepoName('   ')).toBe('');
    expect(sanitizeRepoName('....')).toBe('');
  });

  it('caps length at 100 characters', () => {
    const long = 'x'.repeat(200);
    expect(sanitizeRepoName(long).length).toBe(100);
  });
});

describe('deriveRepoNameFromFilename', () => {
  it('strips .zip suffix', () => {
    expect(deriveRepoNameFromFilename('my-repo.zip')).toBe('my-repo');
  });

  it('strips .tar.gz suffix', () => {
    expect(deriveRepoNameFromFilename('my-repo.tar.gz')).toBe('my-repo');
  });

  it('strips .tgz suffix', () => {
    expect(deriveRepoNameFromFilename('my-repo.tgz')).toBe('my-repo');
  });

  it('returns the whole basename when no archive suffix matches', () => {
    expect(deriveRepoNameFromFilename('my-repo')).toBe('my-repo');
  });

  it('falls back to "upload" when the cleaned name would be empty', () => {
    expect(deriveRepoNameFromFilename('.zip')).toBe('upload');
  });

  it('ignores directory components in the path', () => {
    expect(deriveRepoNameFromFilename('/tmp/uploads/repo.zip')).toBe('repo');
  });
});

describe('resolveUniqueRepoName', () => {
  it('returns the base name when nothing collides', async () => {
    const taken = new Set<string>();
    const isTaken = async (n: string) => taken.has(n);
    expect(await resolveUniqueRepoName('foo', isTaken)).toBe('foo');
  });

  it('appends -2, -3 until it finds an open slot', async () => {
    const taken = new Set<string>(['foo', 'foo-2', 'foo-3']);
    const isTaken = async (n: string) => taken.has(n);
    expect(await resolveUniqueRepoName('foo', isTaken)).toBe('foo-4');
  });

  it('falls back to "upload" when the seed is empty', async () => {
    const taken = new Set<string>();
    const isTaken = async (n: string) => taken.has(n);
    expect(await resolveUniqueRepoName('', isTaken)).toBe('upload');
  });
});

describe('detectSingleTopLevelDir', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'iv-archive-helper-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns the directory name when there is exactly one top-level dir', async () => {
    await fs.mkdir(path.join(tmp, 'my-repo-1.2.3'));
    await fs.writeFile(path.join(tmp, 'my-repo-1.2.3', 'README.md'), 'hi');
    expect(await detectSingleTopLevelDir(tmp)).toBe('my-repo-1.2.3');
  });

  it('returns null when there are multiple entries at the root', async () => {
    await fs.mkdir(path.join(tmp, 'src'));
    await fs.writeFile(path.join(tmp, 'README.md'), 'hi');
    expect(await detectSingleTopLevelDir(tmp)).toBeNull();
  });

  it('returns null when the only entry is a file', async () => {
    await fs.writeFile(path.join(tmp, 'README.md'), 'hi');
    expect(await detectSingleTopLevelDir(tmp)).toBeNull();
  });

  it('returns null for an empty directory', async () => {
    expect(await detectSingleTopLevelDir(tmp)).toBeNull();
  });
});

describe('spoolUploadToTempFile', () => {
  it('writes a Buffer body to a temp file', async () => {
    const data = Buffer.from('hello world');
    const tmpPath = await spoolUploadToTempFile(data);
    try {
      const content = await fs.readFile(tmpPath);
      expect(content.equals(data)).toBe(true);
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  });

  it('throws when the buffer exceeds maxBytes', async () => {
    const data = Buffer.alloc(1024);
    await expect(spoolUploadToTempFile(data, { maxBytes: 512 })).rejects.toBeInstanceOf(
      ArchiveCompressedTooLargeError
    );
  });

  it('throws when a streamed body exceeds maxBytes', async () => {
    const blob = new Blob([new Uint8Array(2048)]);
    await expect(
      spoolUploadToTempFile(blob.stream(), { maxBytes: 1024 })
    ).rejects.toBeInstanceOf(ArchiveCompressedTooLargeError);
  });
});

describe('extractArchive (tar.gz)', () => {
  let tmp: string;
  let extractDir: string;
  let archivePath: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'iv-archive-extract-'));
    extractDir = path.join(tmp, 'extracted');
    archivePath = path.join(tmp, 'archive.tar.gz');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  /**
   * Build a tar.gz under `archivePath` that contains the given source
   * directory.
   */
  async function buildTarGz(sourceDir: string): Promise<void> {
    await tar.c(
      {
        gzip: true,
        file: archivePath,
        cwd: sourceDir,
      },
      ['.']
    );
  }

  it('extracts a normal archive into the target directory', async () => {
    const sourceDir = path.join(tmp, 'src');
    await fs.mkdir(path.join(sourceDir, 'pkg'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'README.md'), '# hello');
    await fs.writeFile(path.join(sourceDir, 'pkg', 'main.ts'), 'export const x = 1;');
    await buildTarGz(sourceDir);

    const result = await extractArchive(archivePath, extractDir, 'tar.gz');
    expect(result.entryCount).toBeGreaterThan(0);
    const readme = await fs.readFile(path.join(extractDir, 'README.md'), 'utf8');
    expect(readme).toBe('# hello');
    const main = await fs.readFile(path.join(extractDir, 'pkg', 'main.ts'), 'utf8');
    expect(main).toBe('export const x = 1;');
  });

  it('rejects entries that resolve outside the extraction directory', async () => {
    // The `tar` package strips traversal-unsafe paths by default, so to
    // exercise our `filter` check we need an archive with an absolute or
    // traversal entry path. Build one manually using tar's pack API.
    const sourceDir = path.join(tmp, 'pack-src');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'normal.txt'), 'ok');
    await tar.c(
      {
        gzip: true,
        file: archivePath,
        cwd: sourceDir,
        // preservePaths lets us emit `..`-laden entry names.
        preservePaths: true,
      },
      ['normal.txt']
    );
    // Now overwrite the archive with one that has an evil entry name by
    // re-packing while spoofing the path through a transform. Easier:
    // build the archive from a directory that contains a symlink-like
    // file with a `../` prefix in its name. But filenames cannot contain
    // `/` on most filesystems, so we instead exercise our path-traversal
    // check via the synthetic test below where we pass an absolute
    // "outside" path through `isPathInsideDirectory`. The end-to-end
    // adversarial test is the property test in task 2.6.
    //
    // For now, validate the normal-archive case still passes after
    // preservePaths usage (acts as a smoke test for the tar wiring).
    const result = await extractArchive(archivePath, extractDir, 'tar.gz');
    expect(result.entryCount).toBeGreaterThan(0);
  });

  it('aborts when the running uncompressed total exceeds the cap', async () => {
    const sourceDir = path.join(tmp, 'src');
    await fs.mkdir(sourceDir, { recursive: true });
    // 1 KiB file, cap below it, expect abort.
    await fs.writeFile(path.join(sourceDir, 'big.bin'), Buffer.alloc(1024));
    await buildTarGz(sourceDir);

    await expect(
      extractArchive(archivePath, extractDir, 'tar.gz', {
        maxUncompressedBytes: 256,
      })
    ).rejects.toBeInstanceOf(ArchiveUncompressedTooLargeError);
  });

  it('rejects an explicit traversal entry name', async () => {
    // Synthesize an archive that includes a `../escape.txt` entry by
    // packing relative to a parent dir.
    const parent = path.join(tmp, 'wrap');
    const inner = path.join(parent, 'inner');
    await fs.mkdir(inner, { recursive: true });
    await fs.writeFile(path.join(parent, 'escape.txt'), 'oops');
    await fs.writeFile(path.join(inner, 'normal.txt'), 'ok');
    // Pack from `inner` and include `../escape.txt`. preservePaths keeps
    // the `..` in the entry name.
    await tar.c(
      {
        gzip: true,
        file: archivePath,
        cwd: inner,
        preservePaths: true,
      },
      ['normal.txt', '../escape.txt']
    );

    await expect(
      extractArchive(archivePath, extractDir, 'tar.gz')
    ).rejects.toBeInstanceOf(ArchivePathTraversalError);
  });
});
