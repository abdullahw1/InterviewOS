/**
 * POST /api/drills/[id]/voice/start
 *
 * Vapi orchestrator entrypoint. Builds the assistant config from the
 * Drill's `configJson`, registers a `fetchCodeChunk` function tool
 * pointing at our tool endpoint, runs the Budget_Guard pre-check, and
 * mints an ephemeral Web SDK token via the Vapi server API. Returns
 * `{ ephemeralToken, vapiPublicKey, ... }` for the browser to pass to
 * `vapi.start()`.
 *
 * `VAPI_API_KEY` is never returned in the response or logged.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 12.3, 20.1, 20.2
 */

import { NextRequest, NextResponse } from 'next/server';

import {
  httpErrorResponse,
  requireUser,
  assertProjectsOwnedBy,
  getBudgetCaps,
} from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { precheckDrill } from '@/lib/services/budget-guard';
import {
  buildAssistantConfig,
  createVapiCall,
  type DrillConfigSnapshot,
  type ProjectWithSummary,
} from '@/lib/services/vapi/orchestrator';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const { id: drillId } = await ctx.params;

    const drill = await prisma.drill.findUnique({ where: { id: drillId } });
    if (!drill || drill.userId !== user.id) {
      return NextResponse.json({ error: 'Drill not found' }, { status: 404 });
    }
    if (drill.mode !== 'Voice') {
      return NextResponse.json({ error: 'This is not a Voice drill' }, { status: 400 });
    }

    const config = drill.configJson as unknown as DrillConfigSnapshot;
    if (!config || !Array.isArray(config.selectedRepos)) {
      return NextResponse.json(
        { error: 'Drill is missing a valid configJson' },
        { status: 400 },
      );
    }
    await assertProjectsOwnedBy(user.id, config.selectedRepos);

    // --- Budget guard pre-check ---
    const guard = await precheckDrill({
      userId: user.id,
      lengthMinutes: config.lengthMinutes,
      mode: 'Voice',
    });
    if (!guard.ok) {
      return NextResponse.json(
        {
          error: 'Budget cap would be exceeded',
          capName: guard.capName,
          currentSpend: guard.currentSpend,
        },
        { status: 409 },
      );
    }

    // --- Gather Project_Summary + retrieved chunks for the system prompt ---
    // For Whole_Portfolio scope, selectedRepos is [] — fetch all user projects.
    const projectFilter =
      config.selectedRepos.length > 0
        ? { id: { in: config.selectedRepos }, userId: user.id }
        : { userId: user.id };

    const projects = (await prisma.project.findMany({
      where: projectFilter,
      include: { summary: true },
    })) as ProjectWithSummary[];

    const projectIds = projects.map((p) => p.id);

    // pgvector is not installed, so chunk retrieval is a simple
    // findMany ordered by chunkIndex, capped at 10 total across all
    // selected projects (spec Requirement 9.3).
    const chunks = await prisma.projectChunk.findMany({
      where: { projectId: { in: projectIds } },
      select: { repoName: true, filePath: true, content: true },
      orderBy: { chunkIndex: 'asc' },
      take: 10,
    });

    // --- Build assistant config and pre-create the Vapi web call ---
    const assistant = buildAssistantConfig(drill, projects, chunks);
    const { assistantId, webCallUrl, callId } = await createVapiCall(assistant);

    const caps = getBudgetCaps();
    const vapiPerMinuteRate = parseFloat(process.env.VAPI_PER_MINUTE_RATE ?? '0.10');

    return NextResponse.json({
      drillId,
      assistantId,
      webCallUrl,
      vapiPublicKey: process.env.VAPI_PUBLIC_KEY ?? '',
      callId,
      maxDrillVapiMinutes: caps.maxDrillVapiMinutes,
      vapiPerMinuteRate,
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('POST /api/drills/[id]/voice/start error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
