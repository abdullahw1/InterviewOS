import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const summaries = await prisma.projectSummary.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        repoName: true,
        description: true,
        techStack: true,
        highlights: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ summaries });
  } catch (error) {
    console.error('Error fetching project summaries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summaries' },
      { status: 500 }
    );
  }
}
