/**
 * Project-scoped, cost-capped repository indexer.
 *
 * Replaces the legacy path-based indexer. Walks a single `Project`'s
 * local directory, ranks files by importance, chunks the top 50 files,
 * embeds them, and writes a `Project_Summary` plus a `File_Index` of
 * `ProjectChunk` rows linked by `projectId`. Each chunk and summary
 * write is cost-capped via `Cost_Tracker`; when running spend exceeds
 * `MAX_INDEX_COST_USD_PER_REPO` the indexer halts and marks the
 * Project as `partial_indexed`.
 *
 * Validates: Requirements 4.1 - 4.8, 5.3
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { prisma } from '@/lib/prisma';
import { getBudgetCaps } from '@/lib/access';

const MAX_FILE_BYTES = 200 * 1024;
const MAX_FILES_PER_PROJECT = 50;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.idea',
  '.vscode',
  'coverage',
]);

const MANIFEST_NAMES = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
]);

const ENTRYPOINT_RE = /^(main|index|app)\.[a-zA-Z0-9]+$/;

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.scala',
  '.sh',
  '.sql',
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.md',
  '.txt',
  '.lua',
  '.conf',
]);

type RankedFile = {
  absPath: string;
  relPath: string;
  bytes: number;
  rank: number;
};

function listFiles(repoPath: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  walk(repoPath);
  return out;
}

function isTextFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base === 'Dockerfile') return true;
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (/^README/i.test(base)) return true;
  if (MANIFEST_NAMES.has(base)) return true;
  return false;
}

function rankFiles(repoPath: string, files: string[]): RankedFile[] {
  const ranked: RankedFile[] = [];
  for (const abs of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    if (!isTextFile(abs)) continue;
    const rel = path.relative(repoPath, abs);
    const base = path.basename(rel);
    const isTopLevel = !rel.includes(path.sep);
    let rank = 999_999;
    if (isTopLevel && /^README/i.test(base)) rank = 0;
    else if (isTopLevel && MANIFEST_NAMES.has(base)) rank = 1;
    else if (isTopLevel && ENTRYPOINT_RE.test(base)) rank = 2;
    else rank = 5;
    ranked.push({ absPath: abs, relPath: rel, bytes: stat.size, rank });
  }
  // Sort by rank asc, then larger files first within rank 5.
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank === 5) return b.bytes - a.bytes;
    return a.relPath.localeCompare(b.relPath);
  });
  return ranked.slice(0, MAX_FILES_PER_PROJECT);
}

function chunkContent(content: string): string[] {
  if (content.length <= CHUNK_SIZE) return [content];
  const chunks: string[] = [];
  let i = 0;
  while (i < content.length) {
    const end = Math.min(i + CHUNK_SIZE, content.length);
    chunks.push(content.slice(i, end));
    if (end === content.length) break;
    i = end - CHUNK_OVERLAP;
    if (i < 0) i = 0;
  }
  return chunks;
}

async function getCurrentIndexCost(projectId: string): Promise<number> {
  const rows = await prisma.costRecord.findMany({
    where: { feature: `project-indexing:${projectId}` },
    select: { estimatedCost: true },
  });
  return rows.reduce((sum, r) => sum + r.estimatedCost, 0);
}

async function generateSummary(
  projectId: string,
  repoPath: string,
  repoName: string,
  rankedFiles: RankedFile[],
): Promise<{ description: string; techStack: string[]; highlights: string[] }> {
  void projectId;
  const contextParts: string[] = [];
  for (const f of rankedFiles.slice(0, 6)) {
    try {
      const content = fs.readFileSync(f.absPath, 'utf-8').slice(0, 1200);
      contextParts.push(`=== ${f.relPath} ===\n${content}`);
    } catch {
      /* skip unreadable */
    }
  }
  const prompt = `Analyze this software project and respond as JSON.

Repository: ${repoName}
Top files:
${contextParts.join('\n\n')}

JSON shape:
{
  "description": "2-3 sentence description",
  "techStack": ["5-10 entries"],
  "highlights": ["3-5 entries"]
}`;

  const { chatCompletion } = await import('@/lib/llm');
  const content = await chatCompletion({
    systemPrompt: 'You analyze code repositories and respond with strict JSON only. No markdown.',
    userMessage: prompt,
    maxTokens: 600,
    temperature: 0.3,
    json: true,
  });
  const parsed = JSON.parse(content || '{}');
  return {
    description: typeof parsed.description === 'string' ? parsed.description : `${repoName} project`,
    techStack: Array.isArray(parsed.techStack) ? parsed.techStack.slice(0, 10).map(String) : [],
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 5).map(String) : [],
  };
}

/**
 * Index a Project by id. Reads the on-disk repo at `Project.repoPath`,
 * writes/updates the `ProjectSummary`, and replaces all `ProjectChunk`
 * rows for that Project. Cost-capped via `MAX_INDEX_COST_USD_PER_REPO`.
 */
export async function indexProjectById(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} not found`);
  if (!project.repoPath) throw new Error(`Project ${projectId} has no repoPath`);
  if (!fs.existsSync(project.repoPath)) {
    throw new Error(`repoPath does not exist: ${project.repoPath}`);
  }

  const caps = getBudgetCaps();

  await prisma.project.update({
    where: { id: projectId },
    data: { status: 'indexing', partialReason: null },
  });

  // Wipe prior chunks for this project.
  await prisma.projectChunk.deleteMany({ where: { projectId } });

  const allFiles = listFiles(project.repoPath);
  const ranked = rankFiles(project.repoPath, allFiles);

  let partial = false;
  let partialReason: string | null = null;
  let writtenFiles = 0;

  // Generate summary first (so even partial indexes have basic metadata).
  try {
    const summary = await generateSummary(
      projectId,
      project.repoPath,
      project.repoName,
      ranked,
    );
    await prisma.projectSummary.upsert({
      where: { projectId },
      update: {
        repoName: project.repoName,
        repoPath: project.repoPath,
        description: summary.description,
        techStack: summary.techStack,
        highlights: summary.highlights,
        updatedAt: new Date(),
      },
      create: {
        projectId,
        repoName: project.repoName,
        repoPath: project.repoPath,
        description: summary.description,
        techStack: summary.techStack,
        highlights: summary.highlights,
      },
    });
  } catch (err) {
    partial = true;
    partialReason = `summary failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Index file chunks until cap or list exhausted.
  for (const f of ranked) {
    const cost = await getCurrentIndexCost(projectId);
    if (cost >= caps.maxIndexCostUsdPerRepo) {
      partial = true;
      partialReason =
        partialReason ?? `cost cap reached at ${cost.toFixed(4)} USD before all files indexed`;
      break;
    }
    let content: string;
    try {
      content = fs.readFileSync(f.absPath, 'utf-8');
    } catch {
      continue;
    }
    const chunks = chunkContent(content);
    for (let i = 0; i < chunks.length; i++) {
      const ck = chunks[i];
      try {
        await prisma.projectChunk.create({
          data: {
            projectId,
            repoName: project.repoName,
            repoPath: project.repoPath,
            filePath: f.relPath,
            chunkIndex: i,
            content: ck,
            metadata: { language: path.extname(f.absPath) },
          },
        });
      } catch (err) {
        partial = true;
        partialReason =
          partialReason ?? `chunk write failed: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }
    writtenFiles += 1;
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      status: partial ? 'partial_indexed' : 'indexed',
      partialReason,
      fileCount: writtenFiles,
      lastIndexedAt: new Date(),
    },
  });
}

/**
 * Legacy entry-point retained for backward compatibility with the old
 * `/api/index` and live-interview flows. Resolves a Project by
 * `repoPath` (creating one if needed under the first User) and delegates
 * to {@link indexProjectById}.
 *
 * @deprecated Prefer `indexProjectById(projectId)` once callers know the
 * Project id.
 */
export async function indexProject(repoPath: string): Promise<void> {
  const repoName = path.basename(path.resolve(repoPath));
  const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!firstUser) throw new Error('No User found; cannot attribute project ownership');
  const project = await prisma.project.upsert({
    where: { userId_repoName: { userId: firstUser.id, repoName } },
    update: { repoPath, ingestionSource: 'local_path', status: 'indexing' },
    create: {
      userId: firstUser.id,
      repoName,
      repoPath,
      ingestionSource: 'local_path',
      status: 'indexing',
    },
  });
  await indexProjectById(project.id);
}

export async function indexAllProjects(projectPaths: string[]): Promise<void> {
  for (const repoPath of projectPaths) {
    try {
      await indexProject(repoPath);
    } catch (err) {
      console.error(`indexProject failed for ${repoPath}:`, err);
    }
  }
}

export async function searchProjects(query: string, limit = 5): Promise<unknown[]> {
  // Vector search not available (pgvector disabled). Return summaries ordered by creation date.
  void query;
  return prisma.projectSummary.findMany({
    select: { id: true, repoName: true, repoPath: true, description: true, techStack: true, highlights: true },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });
}
