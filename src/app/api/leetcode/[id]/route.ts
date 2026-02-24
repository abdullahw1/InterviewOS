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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { result, timeSpent, notes } = body;

    // Fetch current entry
    const entry = await prisma.leetCodeEntry.findUnique({
      where: { id },
    });

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    // Calculate new review schedule
    const quality = resultToQuality(result);
    const reviewData = calculateNextReview({
      repetitions: entry.repetitions,
      easeFactor: entry.easeFactor,
      interval: entry.interval,
      quality,
    });

    // Update entry
    const updated = await prisma.leetCodeEntry.update({
      where: { id },
      data: {
        result,
        timeSpent: timeSpent ? parseInt(timeSpent) : entry.timeSpent,
        repetitions: reviewData.repetitions,
        easeFactor: reviewData.easeFactor,
        interval: reviewData.interval,
        nextReviewDate: reviewData.nextReviewDate,
        lastReviewDate: new Date(),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating LeetCode entry:', error);
    return NextResponse.json(
      { error: 'Failed to update entry' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    await prisma.leetCodeEntry.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting LeetCode entry:', error);
    return NextResponse.json(
      { error: 'Failed to delete entry' },
      { status: 500 }
    );
  }
}
