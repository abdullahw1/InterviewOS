import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { indexRepositories } from '@/lib/services/indexing';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const repoPaths = process.env.REPO_PATHS?.split(',').map(p => p.trim()) || [];
    
    if (repoPaths.length === 0) {
      return NextResponse.json(
        { error: 'No repository paths configured in REPO_PATHS env var' },
        { status: 400 }
      );
    }

    const result = await indexRepositories(repoPaths);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Indexing error:', error);
    return NextResponse.json(
      { error: 'Failed to index repositories' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const totalChunks = await prisma.projectChunk.count();
    
    // Get unique repos
    const chunks = await prisma.projectChunk.findMany({
      select: { repoPath: true, createdAt: true },
      distinct: ['repoPath'],
    });
    
    const repos = chunks.map(c => ({
      path: c.repoPath,
      lastIndexed: c.createdAt,
    }));

    return NextResponse.json({
      totalChunks,
      repos,
    });
  } catch (error) {
    console.error('Status fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch indexing status' },
      { status: 500 }
    );
  }
}
