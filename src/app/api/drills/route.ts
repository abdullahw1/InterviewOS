/**
 * POST /api/drills
 *
 * Creates a new Drill with the validated Drill_Config persisted as
 * `configJson`. No questions are generated here — that happens when the
 * user starts the drill (text or voice).
 *
 * Validates: Requirements 7.1–7.7, 20.2, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { httpErrorResponse, requireUser, assertProjectsOwnedBy } from '@/lib/access';
import { prisma } from '@/lib/prisma';

const QUESTION_TYPES = [
  'Code_Tracing',
  'Modification',
  'Design_Rationale',
  'Debugging',
  'Tradeoffs',
  'Scaling',
  'Security',
  'Behavioral',
] as const;

const DIFFICULTY_TIERS = ['Easy', 'Medium', 'Hard', 'Staff'] as const;
const PERSONAS = ['Friendly_Mentor', 'Staff_Engineer', 'Hostile', 'Startup_Founder'] as const;
const REPO_SCOPES = ['Single', 'Multi', 'Whole_Portfolio'] as const;
const DRILL_MODES = ['Text', 'Voice'] as const;

const DrillConfigSchema = z.object({
  lengthMinutes: z.number().int().min(5).max(60),
  questionCount: z.number().int().min(1).max(20),
  repoScope: z.enum(REPO_SCOPES),
  selectedRepos: z.array(z.string()).default([]),
  difficultyTier: z.enum(DIFFICULTY_TIERS),
  questionTypes: z.array(z.enum(QUESTION_TYPES)).min(1),
  persona: z.enum(PERSONAS),
  mode: z.enum(DRILL_MODES),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);

    const body = await req.json();
    const parsed = DrillConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const config = parsed.data;
    let selectedRepos = config.selectedRepos;

    // --- Repo scope validation ---

    if (config.repoScope === 'Single') {
      if (selectedRepos.length !== 1) {
        return NextResponse.json(
          { error: 'Single scope requires exactly one repository' },
          { status: 400 }
        );
      }
    } else if (config.repoScope === 'Multi') {
      if (selectedRepos.length < 2) {
        return NextResponse.json(
          { error: 'Multi scope requires at least two repositories' },
          { status: 400 }
        );
      }
    } else if (config.repoScope === 'Whole_Portfolio') {
      // Expand to all indexed/partial_indexed projects for this user
      const allProjects = await prisma.project.findMany({
        where: {
          userId: user.id,
          status: { in: ['indexed', 'partial_indexed'] },
        },
        select: { id: true },
      });
      selectedRepos = allProjects.map((p) => p.id);

      if (selectedRepos.length === 0) {
        return NextResponse.json(
          { error: 'No indexed projects available for Whole Portfolio scope' },
          { status: 400 }
        );
      }
    }

    // --- Ownership check ---
    await assertProjectsOwnedBy(user.id, selectedRepos);

    // --- Block repos that are cloning or failed ---
    const blockedProjects = await prisma.project.findMany({
      where: {
        id: { in: selectedRepos },
        status: { in: ['cloning', 'failed'] },
      },
      select: { id: true, repoName: true, status: true },
    });

    if (blockedProjects.length > 0) {
      const names = blockedProjects.map((p) => p.repoName);
      return NextResponse.json(
        {
          error: 'Some selected repositories are not ready',
          blockedRepos: names,
        },
        { status: 400 }
      );
    }

    // --- Block Behavioral-only when no Question Bank entries exist ---
    const isBehavioralOnly =
      config.questionTypes.length === 1 && config.questionTypes[0] === 'Behavioral';

    if (isBehavioralOnly) {
      const behavioralCount = await prisma.questionBankEntry.count({
        where: {
          userId: user.id,
          questionType: 'Behavioral',
        },
      });

      if (behavioralCount === 0) {
        return NextResponse.json(
          {
            error:
              'You have no Behavioral entries in your Question Bank. Add some before starting a Behavioral-only drill.',
          },
          { status: 400 }
        );
      }
    }

    // --- Persist the Drill row with configJson ---
    const drillConfig = {
      lengthMinutes: config.lengthMinutes,
      questionCount: config.questionCount,
      repoScope: config.repoScope,
      selectedRepos,
      difficultyTier: config.difficultyTier,
      questionTypes: config.questionTypes,
      persona: config.persona,
    };

    const drill = await prisma.drill.create({
      data: {
        userId: user.id,
        mode: config.mode,
        configJson: drillConfig,
        status: 'pending',
      },
    });

    return NextResponse.json(
      {
        drill: {
          id: drill.id,
          mode: drill.mode,
          status: drill.status,
          configJson: drill.configJson,
          createdAt: drill.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;

    console.error('POST /api/drills error', err);
    return NextResponse.json({ error: 'Failed to create drill' }, { status: 500 });
  }
}
