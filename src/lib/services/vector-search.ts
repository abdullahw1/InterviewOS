import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getModelConfig } from '@/lib/config/models';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface SearchResult {
  id: string;
  repoPath: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function searchSimilarChunks(
  query: string,
  projectName?: string,
  topK: number = 5
): Promise<SearchResult[]> {
  const modelConfig = getModelConfig();
  
  // Generate embedding for the query
  const embeddingResponse = await openai.embeddings.create({
    model: modelConfig.embedding,
    input: query,
  });
  
  const queryEmbedding = embeddingResponse.data[0].embedding;
  
  // Fetch all chunks (or filter by project if specified)
  const chunks = await prisma.projectChunk.findMany({
    where: projectName ? { repoPath: { contains: projectName } } : undefined,
  });
  
  // Calculate similarities
  const results: SearchResult[] = chunks.map(chunk => {
    const chunkEmbedding = chunk.embedding as number[];
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
    
    return {
      id: chunk.id,
      repoPath: chunk.repoPath,
      filePath: chunk.filePath,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      similarity,
    };
  });
  
  // Sort by similarity and take top K
  results.sort((a, b) => b.similarity - a.similarity);
  
  // Limit total context size (approximately 4000 tokens = ~16000 characters)
  const maxContextSize = 16000;
  let currentSize = 0;
  const filteredResults: SearchResult[] = [];
  
  for (const result of results.slice(0, topK * 2)) {
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
