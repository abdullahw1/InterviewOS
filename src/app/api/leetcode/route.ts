import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { calculateNextReview, resultToQuality } from '@/lib/services/spaced-repetition';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dueOnly = searchParams.get('dueOnly') === 'true';

    const where = dueOnly
      ? { nextReviewDate: { lte: new Date() } }
      : {};

    const entries = await prisma.leetCodeEntry.findMany({
      where,
      orderBy: { nextReviewDate: 'asc' },
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error('Error fetching LeetCode entries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      problemName,
      problemUrl,
      pattern,
      difficulty,
      timeSpent,
      result,
    } = body;

    if (!problemName || !pattern || !difficulty || !timeSpent || !result) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Calculate initial review schedule
    const quality = resultToQuality(result);
    const reviewData = calculateNextReview({
      repetitions: 0,
      easeFactor: 2.5,
      interval: 0,
      quality,
    });

    const entry = await prisma.leetCodeEntry.create({
      data: {
        problemName,
        problemUrl: problemUrl || null,
        pattern,
        difficulty,
        timeSpent: parseInt(timeSpent),
        result,
        repetitions: reviewData.repetitions,
        easeFactor: reviewData.easeFactor,
        interval: reviewData.interval,
        nextReviewDate: reviewData.nextReviewDate,
        lastReviewDate: new Date(),
      },
    });

    return NextResponse.json(entry);
  } catch (error) {
    console.error('Error creating LeetCode entry:', error);
    return NextResponse.json(
      { error: 'Failed to create entry' },
      { status: 500 }
    );
  }
}
