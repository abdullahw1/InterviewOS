import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

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
    const groupByStage = searchParams.get('groupByStage') === 'true';

    const applications = await prisma.jobApplication.findMany({
      orderBy: { appliedDate: 'desc' },
    });

    if (groupByStage) {
      const grouped = applications.reduce((acc, app) => {
        if (!acc[app.stage]) {
          acc[app.stage] = [];
        }
        acc[app.stage].push(app);
        return acc;
      }, {} as Record<string, typeof applications>);

      return NextResponse.json(grouped);
    }

    return NextResponse.json(applications);
  } catch (error) {
    console.error('Error fetching job applications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch applications' },
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
    const { company, role, stage, url, notes, followUpDate } = body;

    if (!company || !role || !stage) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const application = await prisma.jobApplication.create({
      data: {
        company,
        role,
        stage,
        url: url || null,
        notes: notes || null,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
      },
    });

    return NextResponse.json(application);
  } catch (error) {
    console.error('Error creating job application:', error);
    return NextResponse.json(
      { error: 'Failed to create application' },
      { status: 500 }
    );
  }
}
