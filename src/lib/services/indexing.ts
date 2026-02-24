import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getModelConfig } from '@/lib/config/models';
import { trackedOpenAICall } from '@/lib/services/cost-tracker';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// File extensions to include
const INCLUDE_EXTENSIONS = [
  '.md', '.yaml', '.yml', '.ts', '.tsx', '.py', '.lua', '.js', '.jsx',
  '.json', '.sql', '.sh', '.dockerfile', 'Dockerfile', '.txt', '.conf'
];

// Directories to exclude
const EXCLUDE_DIRS = [
  'node_modules', '.next', '.git', 'build', 'dist', 'out', 'coverage',
  '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode'
];

// Files to exclude
const EXCLUDE_FILES = [
  '.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
];

interface FileInfo {
  path: string;
  content: string;
}

interface Chunk {
  repoPath: string;
  filePath: string;
  chunkIndex: number;
  content: string;
}

export function shouldIncludeFile(filePath: string): boolean {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath);
  
  // Exclude specific files
  if (EXCLUDE_FILES.includes(fileName)) return false;
  
  // Include README files
  if (fileName.startsWith('README')) return true;
  
  // Include Dockerfile
  if (fileName === 'Dockerfile' || fileName.endsWith('.dockerfile')) return true;
  
  // Include by extension
  return INCLUDE_EXTENSIONS.includes(ext);
}

export function shouldExcludeDir(dirName: string): boolean {
  return EXCLUDE_DIRS.includes(dirName);
}

export function scanDirectory(dirPath: string): FileInfo[] {
  const files: FileInfo[] = [];
  
  function scan(currentPath: string) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!shouldExcludeDir(entry.name)) {
            scan(fullPath);
          }
        } else if (entry.isFile()) {
          if (shouldIncludeFile(fullPath)) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              // Skip binary files and very large files
              if (content.length > 0 && content.length < 500000) {
                files.push({
                  path: fullPath,
                  content,
                });
              }
            } catch (err) {
              console.error(`Error reading file ${fullPath}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error scanning directory ${currentPath}:`, err);
    }
  }
  
  scan(dirPath);
  return files;
}

export function scanRepos(repoPaths: string[]): Map<string, FileInfo[]> {
  const repoFiles = new Map<string, FileInfo[]>();
  
  for (const repoPath of repoPaths) {
    if (fs.existsSync(repoPath)) {
      const files = scanDirectory(repoPath);
      repoFiles.set(repoPath, files);
    } else {
      console.warn(`Repository path does not exist: ${repoPath}`);
    }
  }
  
  return repoFiles;
}

export function chunkFile(content: string, filePath: string): string[] {
  const CHUNK_SIZE = 1000;
  const OVERLAP = 200;
  const chunks: string[] = [];
  
  // Split by lines first
  const lines = content.split('\n');
  let currentChunk = '';
  let currentSize = 0;
  
  for (const line of lines) {
    const lineSize = line.length + 1; // +1 for newline
    
    if (currentSize + lineSize > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk);
      
      // Create overlap by keeping last few lines
      const overlapLines = currentChunk.split('\n').slice(-5).join('\n');
      currentChunk = overlapLines + '\n' + line;
      currentSize = currentChunk.length;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
      currentSize += lineSize;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

export async function generateEmbeddings(chunks: Chunk[]): Promise<number[][]> {
  const modelConfig = getModelConfig();
  const batchSize = 100;
  const allEmbeddings: number[][] = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.content);
    
    const response = await trackedOpenAICall(
      'project-indexing',
      modelConfig.embedding,
      async () => {
        return await openai.embeddings.create({
          model: modelConfig.embedding,
          input: texts,
        });
      },
      (result) => ({
        inputTokens: result.usage?.prompt_tokens || 0,
        outputTokens: 0,
      })
    );
    
    const embeddings = response.data.map(d => d.embedding);
    allEmbeddings.push(...embeddings);
  }
  
  return allEmbeddings;
}

export async function indexRepositories(repoPaths: string[]): Promise<{
  totalFiles: number;
  totalChunks: number;
  repos: { path: string; files: number; chunks: number }[];
}> {
  const repoFiles = scanRepos(repoPaths);
  const allChunks: Chunk[] = [];
  const repoStats: { path: string; files: number; chunks: number }[] = [];
  
  // Create chunks for all files
  for (const [repoPath, files] of repoFiles.entries()) {
    let repoChunkCount = 0;
    
    for (const file of files) {
      const fileChunks = chunkFile(file.content, file.path);
      
      fileChunks.forEach((content, index) => {
        allChunks.push({
          repoPath,
          filePath: file.path,
          chunkIndex: index,
          content,
        });
      });
      
      repoChunkCount += fileChunks.length;
    }
    
    repoStats.push({
      path: repoPath,
      files: files.length,
      chunks: repoChunkCount,
    });
  }
  
  // Generate embeddings
  const embeddings = await generateEmbeddings(allChunks);
  
  // Clear old chunks for these repos
  for (const repoPath of repoPaths) {
    await prisma.projectChunk.deleteMany({
      where: { repoPath },
    });
  }
  
  // Insert new chunks with embeddings
  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    const embedding = embeddings[i];
    
    await prisma.projectChunk.create({
      data: {
        repoPath: chunk.repoPath,
        filePath: chunk.filePath,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding: embedding, // Store as JSON array
      },
    });
  }
  
  return {
    totalFiles: Array.from(repoFiles.values()).reduce((sum, files) => sum + files.length, 0),
    totalChunks: allChunks.length,
    repos: repoStats,
  };
}
