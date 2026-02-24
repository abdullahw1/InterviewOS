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

    const applications = await prisma.jobApplication.findMany({
      orderBy: { appliedDate: 'desc' },
    });

    // Create CSV content
    const headers = [
      'Company',
      'Role',
      'Stage',
      'URL',
      'Applied Date',
      'Follow-up Date',
      'Notes',
    ];

    const rows = applications.map((app) => [
      app.company,
      app.role,
      app.stage,
      app.url || '',
      app.appliedDate.toISOString().split('T')[0],
      app.followUpDate ? app.followUpDate.toISOString().split('T')[0] : '',
      app.notes ? app.notes.replace(/"/g, '""') : '', // Escape quotes
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${cell}"`).join(',')
      ),
    ].join('\n');

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="job-applications-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting job applications:', error);
    return NextResponse.json(
      { error: 'Failed to export applications' },
      { status: 500 }
    );
  }
}
