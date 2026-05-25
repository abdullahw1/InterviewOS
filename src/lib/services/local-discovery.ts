/**
 * Dev-only local Project discovery.
 *
 * Only when `NODE_ENV === 'development'` AND `REPO_PATHS` is set, we walk
 * the configured paths and surface any subdirectory that looks like a
 * code repository (presence of `.git` or a recognizable manifest file).
 *
 * Behavior per Requirements 3.1 - 3.6:
 *   - Walks immediate subdirectories of every entry in `REPO_PATHS`.
 *   - Recurses one extra level into directories whose children are all
 *     directories (so layouts like `sep19/defendai` are found).
 *   - Never follows symlinks.
 *   - Excludes the InterviewOS working directory (process.cwd()).
 *   - Disambiguates name collisions by appending the parent dir name.
 *   - In production this module returns `[]` and `REPO_PATHS` is ignored.
 *
 * See `.kiro/specs/project-interview-drills/design.md`
 * (Components > Server modules > `src/lib/services/local-discovery.ts`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
];

export type LocalProjectDiscovery = {
  /** Suggested `Project.repoName`. Disambiguated for collisions. */
  repoName: string;
  /** Absolute path to the discovered Project root. */
  repoPath: string;
  /** The marker that triggered discovery (for debugging / UI). */
  marker: string;
};

function isLocalDiscoveryEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && Boolean(process.env.REPO_PATHS?.trim());
}

function getConfiguredPaths(): string[] {
  return (
    process.env.REPO_PATHS?.split(',')
      .map((p) => p.trim())
      .filter(Boolean) ?? []
  );
}

function isOwnWorkingDir(absDir: string): boolean {
  try {
    return path.resolve(absDir) === path.resolve(process.cwd());
  } catch {
    return false;
  }
}

function findRepoMarker(absDir: string): string | null {
  for (const marker of REPO_MARKERS) {
    try {
      if (fs.existsSync(path.join(absDir, marker))) return marker;
    } catch {
      /* ignore unreadable directories */
    }
  }
  return null;
}

function listImmediateChildren(absDir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Walk the configured `REPO_PATHS` and return one `LocalProjectDiscovery`
 * per discovered repository. Returns `[]` outside development mode.
 */
export function discoverLocalProjects(): LocalProjectDiscovery[] {
  if (!isLocalDiscoveryEnabled()) return [];
  const seen = new Map<string, LocalProjectDiscovery>(); // key by repoPath
  const nameCounts = new Map<string, number>();

  function record(absDir: string, marker: string) {
    if (seen.has(absDir)) return;
    const baseName = path.basename(absDir);
    const parentName = path.basename(path.dirname(absDir));
    const collisionCount = nameCounts.get(baseName) ?? 0;
    let repoName = baseName;
    if (collisionCount > 0) {
      repoName = `${baseName}-${parentName}`;
      // If still a collision, append numeric suffix.
      let n = 2;
      let candidate = repoName;
      while (Array.from(seen.values()).some((d) => d.repoName === candidate)) {
        candidate = `${repoName}-${n}`;
        n += 1;
      }
      repoName = candidate;
    }
    nameCounts.set(baseName, collisionCount + 1);
    seen.set(absDir, { repoName, repoPath: absDir, marker });
  }

  for (const rootRaw of getConfiguredPaths()) {
    let root: string;
    try {
      root = path.resolve(rootRaw);
    } catch {
      continue;
    }
    if (!fs.existsSync(root)) continue;
    if (isOwnWorkingDir(root)) continue;

    // If the root itself is a repo, record it directly.
    const rootMarker = findRepoMarker(root);
    if (rootMarker) {
      record(root, rootMarker);
      continue;
    }

    const children = listImmediateChildren(root);
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      if (!child.isDirectory()) continue;
      const absChild = path.join(root, child.name);
      if (isOwnWorkingDir(absChild)) continue;

      const marker = findRepoMarker(absChild);
      if (marker) {
        record(absChild, marker);
        continue;
      }

      // No marker at this level. Per Req 3.2, recurse one extra level
      // when this directory's children are all directories themselves
      // (handles layouts like `sep19/defendai`).
      const grandChildren = listImmediateChildren(absChild);
      const allDirs =
        grandChildren.length > 0 &&
        grandChildren.every((g) => g.isDirectory() && !g.isSymbolicLink());
      if (!allDirs) continue;

      for (const grand of grandChildren) {
        if (grand.isSymbolicLink()) continue;
        if (!grand.isDirectory()) continue;
        const absGrand = path.join(absChild, grand.name);
        if (isOwnWorkingDir(absGrand)) continue;
        const grandMarker = findRepoMarker(absGrand);
        if (grandMarker) record(absGrand, grandMarker);
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.repoName.localeCompare(b.repoName));
}
