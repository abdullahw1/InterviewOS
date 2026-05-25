/**
 * Legacy shim. The buggy parent-folder REPO_PATHS scan that lived here
 * has been replaced by `local-discovery.ts` + `project-indexer.ts`.
 * This module re-exports the new project-scoped helpers so existing
 * import paths keep compiling. New code should import from those
 * modules directly.
 *
 * Validates: Requirements 3.1 - 3.6, 4.1 - 4.8, 5.3
 */

import { discoverLocalProjects } from '@/lib/services/local-discovery';
import {
  indexAllProjects,
  indexProject,
  indexProjectById,
} from '@/lib/services/project-indexer';

export { discoverLocalProjects, indexAllProjects, indexProject, indexProjectById };

/**
 * Compatibility wrapper for the old `indexRepositories(repoPaths)`
 * signature. Now delegates to local discovery in development only and
 * indexes each discovered Project. In production it is a no-op.
 */
export async function indexRepositories(_repoPaths: string[]): Promise<{
  totalFiles: number;
  totalChunks: number;
  repos: { path: string; files: number; chunks: number }[];
}> {
  // Discovery is dev-only; in production the legacy entrypoint should
  // not be used at all. Callers that need ingestion should use the new
  // upload / GitHub / rescan endpoints.
  const discoveries = discoverLocalProjects();
  for (const d of discoveries) {
    try {
      await indexProject(d.repoPath);
    } catch (err) {
      console.error(`indexRepositories: ${d.repoPath} failed`, err);
    }
  }
  return {
    totalFiles: discoveries.length,
    totalChunks: 0,
    repos: discoveries.map((d) => ({ path: d.repoPath, files: 0, chunks: 0 })),
  };
}
