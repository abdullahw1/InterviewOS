import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CODE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h',
  '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.sh', '.sql', '.yaml', '.yml',
  '.json', '.md', '.txt', '.env.example',
];

const IGNORE_PATTERNS = [
  'node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv',
  'venv', 'coverage', '.pytest_cache', 'target', 'bin', 'obj', '.DS_Store',
];

interface ProjectMetadata {
  repoName: string;
  repoPath: string;
  description: string;
  techStack: string[];
  highlights: string[];
  fileCount: number;
  languages: Record<string, number>;
}

export async function indexProject(repoPath: string): Promise<void> {
  console.log(`Starting indexing for: ${repoPath}`);
  
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  const repoName = path.basename(repoPath);
  
  // Step 1: Analyze repository structure
  const metadata = await analyzeRepository(repoPath, repoName);
  
  // Step 2: Generate project summary with AI
  const summary = await generateProjectSummary(metadata, repoPath);
  
  // Step 3: Create embedding for summary
  const summaryEmbedding = await createEmbedding(summary.description);
  
  // Step 4: Save project summary
  await prisma.projectSummary.upsert({
    where: { repoName },
    update: {
      repoPath,
      description: summary.description,
      techStack: summary.techStack,
      highlights: summary.highlights,
      embedding: summaryEmbedding,
      updatedAt: new Date(),
    },
    create: {
      repoName,
      repoPath,
      description: summary.description,
      techStack: summary.techStack,
      highlights: summary.highlights,
      embedding: summaryEmbedding,
    },
  });
  
  // Step 5: Index important files
  await indexRepositoryFiles(repoPath, repoName);
  
  console.log(`✓ Completed indexing: ${repoName}`);
}

async function analyzeRepository(repoPath: string, repoName: string): Promise<ProjectMetadata> {
  const files: string[] = [];
  const languages: Record<string, number> = {};
  
  function walkDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (IGNORE_PATTERNS.some(pattern => entry.name.includes(pattern))) {
        continue;
      }
      
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (CODE_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
          languages[ext] = (languages[ext] || 0) + 1;
        }
      }
    }
  }
  
  walkDir(repoPath);
  
  // Read README if exists
  let description = '';
  const readmePath = path.join(repoPath, 'README.md');
  if (fs.existsSync(readmePath)) {
    description = fs.readFileSync(readmePath, 'utf-8').substring(0, 2000);
  }
  
  // Read package.json if exists
  const packageJsonPath = path.join(repoPath, 'package.json');
  let techStack: string[] = [];
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      techStack = [
        ...Object.keys(packageJson.dependencies || {}),
        ...Object.keys(packageJson.devDependencies || {}),
      ].slice(0, 20);
    } catch (e) {
      console.error('Error reading package.json:', e);
    }
  }
  
  return {
    repoName,
    repoPath,
    description,
    techStack,
    highlights: [],
    fileCount: files.length,
    languages,
  };
}

async function generateProjectSummary(metadata: ProjectMetadata, repoPath: string): Promise<{
  description: string;
  techStack: string[];
  highlights: string[];
}> {
  // Read key files for context
  const keyFiles = ['README.md', 'package.json', 'requirements.txt', 'go.mod', 'Cargo.toml'];
  let context = '';
  
  for (const file of keyFiles) {
    const filePath = path.join(repoPath, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      context += `\n\n=== ${file} ===\n${content.substring(0, 1000)}`;
    }
  }
  
  const prompt = `Analyze this software project and provide a concise summary:

Repository: ${metadata.repoName}
File Count: ${metadata.fileCount}
Languages: ${Object.entries(metadata.languages).map(([ext, count]) => `${ext}: ${count}`).join(', ')}

Context:
${context}

Provide:
1. A 2-3 sentence description of what this project does
2. Key technologies used (5-10 items)
3. Notable features or achievements (3-5 items)

Format as JSON:
{
  "description": "...",
  "techStack": ["tech1", "tech2", ...],
  "highlights": ["feature1", "feature2", ...]
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a technical analyst summarizing software projects.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500,
  });

  const result = JSON.parse(completion.choices[0].message.content || '{}');
  
  return {
    description: result.description || metadata.description || `${metadata.repoName} project`,
    techStack: result.techStack || metadata.techStack,
    highlights: result.highlights || [],
  };
}

async function indexRepositoryFiles(repoPath: string, repoName: string): Promise<void> {
  // Delete existing chunks for this repo
  await prisma.projectChunk.deleteMany({
    where: { repoName },
  });
  
  const importantFiles: string[] = [];
  
  function findImportantFiles(dir: string, depth: number = 0) {
    if (depth > 3) return; // Limit depth
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (IGNORE_PATTERNS.some(pattern => entry.name.includes(pattern))) {
        continue;
      }
      
      if (entry.isDirectory()) {
        findImportantFiles(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        // Focus on source files and documentation
        if (CODE_EXTENSIONS.includes(ext) && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
          importantFiles.push(fullPath);
        }
      }
    }
  }
  
  findImportantFiles(repoPath);
  
  // Limit to most important files (e.g., 50 files)
  const filesToIndex = importantFiles.slice(0, 50);
  
  for (const filePath of filesToIndex) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(repoPath, filePath);
      
      // Chunk large files
      const chunks = chunkContent(content, 1000);
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await createEmbedding(chunk);
        
        await prisma.projectChunk.create({
          data: {
            repoName,
            repoPath,
            filePath: relativePath,
            chunkIndex: i,
            content: chunk,
            embedding,
            metadata: {
              language: path.extname(filePath),
              fileType: getFileType(filePath),
            },
          },
        });
      }
    } catch (error) {
      console.error(`Error indexing file ${filePath}:`, error);
    }
  }
}

function chunkContent(content: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const lines = content.split('\n');
  let currentChunk = '';
  
  for (const line of lines) {
    if (currentChunk.length + line.length > maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

function getFileType(filePath: string): string {
  const ext = path.extname(filePath);
  const typeMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript-react',
    '.js': 'javascript',
    '.jsx': 'javascript-react',
    '.py': 'python',
    '.go': 'golang',
    '.rs': 'rust',
    '.java': 'java',
    '.md': 'documentation',
  };
  return typeMap[ext] || 'other';
}

async function createEmbedding(text: string): Promise<number[]> {
  // Truncate to max 2000 chars to stay under token limit
  const truncatedText = text.substring(0, 2000);
  
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: truncatedText,
  });
  
  return response.data[0].embedding;
}

export async function indexAllProjects(projectPaths: string[]): Promise<void> {
  console.log(`Indexing ${projectPaths.length} projects...`);
  
  for (const projectPath of projectPaths) {
    try {
      await indexProject(projectPath);
    } catch (error) {
      console.error(`Failed to index ${projectPath}:`, error);
    }
  }
  
  console.log('✓ All projects indexed');
}

export async function searchProjects(query: string, limit: number = 5): Promise<any[]> {
  const queryEmbedding = await createEmbedding(query);
  
  // Get all project summaries and calculate similarity
  const projects = await prisma.projectSummary.findMany();
  
  const results = projects.map(project => {
    const similarity = cosineSimilarity(queryEmbedding, project.embedding as number[]);
    return { ...project, similarity };
  });
  
  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

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
