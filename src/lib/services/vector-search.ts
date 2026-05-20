import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { getModelConfig } from '@/lib/config/models';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function createEmbedding(text: string): Promise<number[]> {
  const modelConfig = getModelConfig();
  const truncatedText = text.substring(0, 2000);

  const response = await openai.embeddings.create({
    model: modelConfig.embedding,
    input: truncatedText,
  });

  return response.data[0].embedding;
}

export async function searchSimilarChunks(
  query: string,
  repoNames?: string[],
  topK: number = 5
): Promise<SearchResult[]> {
  const queryEmbedding = await createEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  let results: SearchResult[];

  if (repoNames && repoNames.length > 0) {
    results = await prisma.$queryRaw<SearchResult[]>`
      SELECT id, "repoName", "filePath", "chunkIndex", content,
             1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM "ProjectChunk"
      WHERE "repoName" = ANY(${repoNames})
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${topK * 2}
    `;
  } else {
    results = await prisma.$queryRaw<SearchResult[]>`
      SELECT id, "repoName", "filePath", "chunkIndex", content,
             1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM "ProjectChunk"
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${topK * 2}
    `;
  }

  // Limit total context size (approximately 4000 tokens = ~16000 characters)
  const maxContextSize = 16000;
  let currentSize = 0;
  const filteredResults: SearchResult[] = [];

  for (const result of results) {
    if (currentSize + result.content.length > maxContextSize) {
      break;
    }
    filteredResults.push(result);
    currentSize += result.content.length;

    if (filteredResults.length >= topK) {
      break;
    }
  }

  return filteredResults;
}

export async function searchSimilarSummaries(
  query: string,
  topK: number = 5
): Promise<SummarySearchResult[]> {
  const queryEmbedding = await createEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  const results = await prisma.$queryRaw<SummarySearchResult[]>`
    SELECT id, "repoName", description, "techStack", highlights,
           1 - (embedding <=> ${embeddingStr}::vector) as similarity
    FROM "ProjectSummary"
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${topK}
  `;

  return results;
}
