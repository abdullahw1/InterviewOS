import { prisma } from '@/lib/prisma';

// pgvector is not available on the current DB, so vector similarity search is not supported.
// Both functions return a plain findMany fallback ordered by creation date.

interface SearchResult {
  id: string;
  repoName: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

interface SummarySearchResult {
  id: string;
  repoName: string;
  description: string;
  techStack: unknown;
  highlights: unknown;
  similarity: number;
}

export async function searchSimilarChunks(
  _query: string,
  repoNames?: string[],
  topK: number = 5
): Promise<SearchResult[]> {
  const rows = await prisma.projectChunk.findMany({
    where: repoNames && repoNames.length > 0 ? { repoName: { in: repoNames } } : undefined,
    select: { id: true, repoName: true, filePath: true, chunkIndex: true, content: true },
    take: topK,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ ...r, similarity: 1 }));
}

export async function searchSimilarSummaries(
  _query: string,
  topK: number = 5
): Promise<SummarySearchResult[]> {
  const rows = await prisma.projectSummary.findMany({
    select: { id: true, repoName: true, description: true, techStack: true, highlights: true },
    take: topK,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ ...r, similarity: 1 }));
}
