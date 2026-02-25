import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { indexAllProjects } from '@/lib/services/project-indexer';

const PROJECT_PATHS = [
  '/Users/abdullahwaheed/Downloads/all-defendai-repos/defendai',
  '/Users/abdullahwaheed/Downloads/all-defendai-repos/defendai-agents',
  '/Users/abdullahwaheed/Downloads/all-defendai-repos/hackathon-projects',
  '/Users/abdullahwaheed/Downloads/all-defendai-repos/wawsdb',
  '/Users/abdullahwaheed/Downloads/all-defendai-repos/wozway',
];

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Start indexing in background
    indexAllProjects(PROJECT_PATHS).catch(error => {
      console.error('Background indexing error:', error);
    });

    return NextResponse.json({
      message: 'Project indexing started',
      projects: PROJECT_PATHS.map(p => p.split('/').pop()),
    });
  } catch (error) {
    console.error('Error starting project indexing:', error);
    return NextResponse.json(
      { error: 'Failed to start indexing' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      projects: PROJECT_PATHS.map(p => ({
        name: p.split('/').pop(),
        path: p,
      })),
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
