import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const interviewSession = await prisma.interviewSession.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!interviewSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get previous session for comparison
    const previousSession = await prisma.interviewSession.findFirst({
      where: {
        company: interviewSession.company,
        createdAt: { lt: interviewSession.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { overallScore: true },
    });

    return NextResponse.json({
      ...interviewSession,
      previousScore: previousSession?.overallScore,
    });
  } catch (error) {
    console.error('Error fetching interview session:', error);
    return NextResponse.json(
      { error: 'Failed to fetch session' },
      { status: 500 }
    );
  }
}
