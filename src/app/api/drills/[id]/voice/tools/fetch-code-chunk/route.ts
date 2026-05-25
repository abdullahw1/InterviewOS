/**
 * POST /api/drills/[id]/voice/tools/fetch-code-chunk
 *
 * Vapi function-tool endpoint. Accepts the Vapi tool-call envelope:
 *   { message: { toolCalls: [{ id, function: { name, arguments: { repoName, query } } }] } }
 * or a direct `{ repoName, query }` body for simpler test harnesses, and
 * returns either:
 *   { results: [{ toolCallId, result: "..." }] }
 * (when the envelope is present) or
 *   { content: "..." }
 * (when called with a flat body).
 *
 * Security: this endpoint is treated as a Vapi-originated tool call. It
 * reads the raw body, verifies `x-vapi-signature` against
 * `VAPI_WEBHOOK_SECRET` via `verifyVapiSignature`. A missing or bad
 * signature returns HTTP 401 with no DB read or write.
 *
 * Behavior:
 *   - Looks up the Drill, expands `configJson.selectedRepos` (Project ids).
 *   - Filters `ProjectChunk` rows by `projectId IN selectedRepos` AND, when
 *     supplied, `repoName`.
 *   - Performs a substring match on `content` against `query` (pgvector is
 *     not installed in this environment); falls back to the first chunks
 *     when nothing matches.
 *   - Returns up to 3 chunks combined-truncated to 1500 characters.
 *   - Emits a `chunk_used` event on the per-drill SSE bus so the in-call
 *     UI can update within 2 seconds.
 *
 * Validates: Requirements 9.4, 9.5, 9.7, 9.8, 20.7
 */

import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { emit } from '@/lib/services/vapi/sse-bus';
import { verifyVapiSignature } from '@/lib/services/vapi/webhook-verify';

type RouteContext = { params: Promise<{ id: string }> };

type ToolCall = {
  id: string;
  function?: { name?: string; arguments?: Record<string, unknown> | string };
};

const MAX_COMBINED_CHARS = 1500;
const MAX_CHUNKS = 3;

function parseArgs(raw: unknown): { repoName: string; query: string } {
  let parsed: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as Record<string, unknown>;
  }
  return {
    repoName: typeof parsed.repoName === 'string' ? parsed.repoName : '',
    query: typeof parsed.query === 'string' ? parsed.query : '',
  };
}

async function fetchChunks(
  selectedRepos: string[],
  repoName: string,
  query: string
): Promise<{ combined: string; usedFiles: string[] }> {
  const where: Record<string, unknown> = { projectId: { in: selectedRepos } };
  if (repoName) where.repoName = repoName;

  let matches: Array<{ filePath: string; content: string; repoName: string }> = [];
  if (query) {
    matches = await prisma.projectChunk.findMany({
      where: {
        ...where,
        content: { contains: query, mode: 'insensitive' },
      },
      select: { filePath: true, content: true, repoName: true },
      take: MAX_CHUNKS,
    });
  }

  if (matches.length === 0) {
    matches = await prisma.projectChunk.findMany({
      where,
      select: { filePath: true, content: true, repoName: true },
      take: MAX_CHUNKS,
      orderBy: { chunkIndex: 'asc' },
    });
  }

  let combined = '';
  const usedFiles: string[] = [];
  for (const m of matches) {
    const piece = `--- ${m.repoName}/${m.filePath} ---\n${m.content}\n\n`;
    if (combined.length + piece.length > MAX_COMBINED_CHARS) {
      const remaining = MAX_COMBINED_CHARS - combined.length;
      if (remaining > 100) {
        combined += piece.slice(0, remaining);
        usedFiles.push(m.filePath);
      }
      break;
    }
    combined += piece;
    usedFiles.push(m.filePath);
  }

  return { combined, usedFiles };
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { id: drillId } = await ctx.params;

  // Read the raw body once so we can verify the signature against the
  // exact bytes Vapi signed.
  const rawBody = await req.text();
  const signature = req.headers.get('x-vapi-signature');
  const secret = process.env.VAPI_WEBHOOK_SECRET ?? '';

  if (!verifyVapiSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { message?: { toolCalls?: ToolCall[] }; repoName?: unknown; query?: unknown };
  try {
    body = rawBody ? (JSON.parse(rawBody) as typeof body) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const drill = await prisma.drill.findUnique({ where: { id: drillId } });
  if (!drill) {
    return NextResponse.json({ error: 'Drill not found' }, { status: 404 });
  }

  const config = drill.configJson as unknown as { selectedRepos?: string[] };
  const selectedRepos = Array.isArray(config?.selectedRepos) ? config.selectedRepos : [];

  const toolCalls = body?.message?.toolCalls ?? [];

  // Tool-call envelope (Vapi's standard shape).
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const results: Array<{ toolCallId: string; result: string }> = [];

    for (const call of toolCalls) {
      if (call?.function?.name !== 'fetchCodeChunk') {
        results.push({ toolCallId: call.id, result: 'Unknown tool.' });
        continue;
      }

      const { repoName, query } = parseArgs(call.function.arguments);
      const { combined, usedFiles } = await fetchChunks(selectedRepos, repoName, query);
      const result = combined || `No code found for repoName="${repoName}" query="${query}".`;

      emit(drillId, {
        type: 'chunk_used',
        filePaths: usedFiles,
        repoName,
        query,
        at: new Date().toISOString(),
      });

      results.push({ toolCallId: call.id, result });
    }

    return NextResponse.json({ results });
  }

  // Flat body fallback: { repoName, query }.
  const { repoName, query } = parseArgs(body);
  const { combined, usedFiles } = await fetchChunks(selectedRepos, repoName, query);
  const content = combined || `No code found for repoName="${repoName}" query="${query}".`;

  emit(drillId, {
    type: 'chunk_used',
    filePaths: usedFiles,
    repoName,
    query,
    at: new Date().toISOString(),
  });

  return NextResponse.json({ content, filePaths: usedFiles });
}
