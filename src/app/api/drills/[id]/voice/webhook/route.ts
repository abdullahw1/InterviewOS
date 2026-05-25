/**
 * POST /api/drills/[id]/voice/webhook
 *
 * Vapi webhook receiver. Reads the raw body, verifies the
 * `x-vapi-signature` header as an HMAC-SHA256 of that body using
 * `VAPI_WEBHOOK_SECRET` via `verifyVapiSignature`. On any signature
 * mismatch, returns HTTP 401 and writes nothing.
 *
 * Handled events:
 *   - `call.started`         → set `Drill.status = 'in_progress'` and
 *                              record `vapiCallId`.
 *   - `transcript.update`    → append the delta to an in-memory transcript
 *                              buffer keyed by drillId so partial fragments
 *                              are preserved if the final fetch times out.
 *   - `tool.call`            → no-op; the tool endpoint persists everything
 *                              that matters and emits its own SSE event.
 *   - `call.ended`           → race a 30 s `GET /call/{id}` against a
 *                              timeout. If the Vapi server returns the
 *                              final transcript and recording, persist
 *                              them with `transcriptStatus = 'full'`.
 *                              Otherwise, persist whatever fragments were
 *                              buffered with `transcriptStatus = 'partial'`.
 *
 * Validates: Requirements 9.4, 9.7, 9.8, 9.9, 9.10, 20.7
 */

import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { emit } from '@/lib/services/vapi/sse-bus';
import { verifyVapiSignature } from '@/lib/services/vapi/webhook-verify';
import { analyzeAndPersistVoiceMetrics } from '@/lib/services/drill/voice-quality';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * In-memory transcript fragment buffer keyed by drill id. Kept here (not
 * in `sse-bus`) so the SSE bus contract stays focused on event fan-out.
 *
 * Each entry is the running concatenation of `transcript.update` deltas
 * received from Vapi. Cleared once the call ends and the row is persisted.
 */
const transcriptBuffers = new Map<string, string>();

/**
 * Append a transcript delta for a drill, keeping the running buffer in
 * memory so a missed `call.ended` server fetch can still produce a
 * useful partial transcript.
 */
function appendTranscriptFragment(drillId: string, fragment: string): void {
  if (!fragment) return;
  const existing = transcriptBuffers.get(drillId) ?? '';
  transcriptBuffers.set(drillId, existing.length > 0 ? `${existing}\n${fragment}` : fragment);
}

function takeTranscriptBuffer(drillId: string): string | null {
  const v = transcriptBuffers.get(drillId);
  if (v === undefined) return null;
  transcriptBuffers.delete(drillId);
  return v;
}

type FetchedCall = {
  transcript: string | null;
  recordingUrl: string | null;
  costUsd: number | null;
  durationSeconds: number | null;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * Fetch the final call record (transcript + recording) from the Vapi
 * server API. Returns `null` on any error or non-2xx response.
 */
async function fetchVapiCall(callId: string): Promise<FetchedCall | null> {
  const apiKey = process.env.VAPI_API_KEY;
  const baseUrl = process.env.VAPI_API_BASE_URL ?? 'https://api.vapi.ai';
  if (!apiKey || !callId) return null;

  try {
    const res = await fetch(`${baseUrl}/call/${callId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;

    const artifact = (data.artifact as Record<string, unknown> | undefined) ?? {};
    const transcript =
      typeof data.transcript === 'string'
        ? data.transcript
        : typeof artifact.transcript === 'string'
          ? (artifact.transcript as string)
          : null;
    const recordingUrl =
      typeof data.recordingUrl === 'string'
        ? data.recordingUrl
        : typeof artifact.recordingUrl === 'string'
          ? (artifact.recordingUrl as string)
          : null;
    const costUsd = typeof data.cost === 'number' ? data.cost : null;
    const startedAt = typeof data.startedAt === 'string' ? new Date(data.startedAt) : null;
    const endedAt = typeof data.endedAt === 'string' ? new Date(data.endedAt) : null;
    const durationSeconds =
      startedAt && endedAt ? Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)) : null;

    return { transcript, recordingUrl, costUsd, durationSeconds };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { id: drillId } = await ctx.params;

  // Read the raw body once for signature verification, then parse.
  const rawBody = await req.text();
  const signature = req.headers.get('x-vapi-signature');
  const secret = process.env.VAPI_WEBHOOK_SECRET ?? '';

  if (!verifyVapiSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = (payload.message as Record<string, unknown> | undefined) ?? payload;
  const eventType =
    (message.type as string | undefined) ??
    (message.event as string | undefined) ??
    'unknown';
  const callObj = (message.call as Record<string, unknown> | undefined) ?? {};
  const callId = (callObj.id as string | undefined) ?? (message.callId as string | undefined) ?? null;

  const drill = await prisma.drill.findUnique({ where: { id: drillId } });
  if (!drill) {
    return NextResponse.json({ error: 'Drill not found' }, { status: 404 });
  }

  switch (eventType) {
    case 'call.started':
    case 'call-started':
    case 'status-update': {
      if (callId) {
        await prisma.drill.update({
          where: { id: drillId },
          data: { status: 'in_progress', vapiCallId: callId },
        });
        emit(drillId, { type: 'call_started', callId });
      }
      break;
    }

    case 'transcript.update':
    case 'transcript': {
      // Buffer transcript fragments so a slow/failed final fetch still
      // yields a useful partial transcript.
      const fragment =
        typeof message.transcript === 'string' ? (message.transcript as string) : '';
      const role = typeof message.role === 'string' ? `[${message.role}] ` : '';
      appendTranscriptFragment(drillId, role + fragment);
      break;
    }

    case 'tool-call':
    case 'tool.call': {
      // The dedicated tool endpoint persists everything that matters and
      // emits its own SSE event. Mirror a low-fidelity event for the UI.
      emit(drillId, { type: 'tool_call', callId });
      break;
    }

    case 'call.ended':
    case 'call-ended':
    case 'end-of-call-report': {
      // Race the Vapi server fetch against a 30 s timeout.
      const fetched = callId ? await withTimeout(fetchVapiCall(callId), 30_000) : null;

      // Fall back to whatever the webhook payload contains.
      const fallbackTranscript =
        typeof message.transcript === 'string'
          ? (message.transcript as string)
          : typeof (message.artifact as Record<string, unknown> | undefined)?.transcript === 'string'
            ? ((message.artifact as Record<string, unknown>).transcript as string)
            : null;
      const fallbackRecording =
        typeof message.recordingUrl === 'string'
          ? (message.recordingUrl as string)
          : typeof (message.artifact as Record<string, unknown> | undefined)?.recordingUrl === 'string'
            ? ((message.artifact as Record<string, unknown>).recordingUrl as string)
            : null;

      const buffered = takeTranscriptBuffer(drillId);
      const transcript = fetched?.transcript ?? fallbackTranscript ?? buffered ?? null;
      const recordingUrl = fetched?.recordingUrl ?? fallbackRecording ?? null;
      // Full only when the server-side Vapi fetch returned a transcript.
      const transcriptStatus: 'full' | 'partial' | 'none' = fetched?.transcript
        ? 'full'
        : transcript
          ? 'partial'
          : 'none';

      const perMinuteRate = parseFloat(process.env.VAPI_PER_MINUTE_RATE ?? '0.10');
      const durationSec = fetched?.durationSeconds ?? null;
      const minutes = durationSec ? durationSec / 60 : 0;
      const vapiCost = fetched?.costUsd ?? minutes * perMinuteRate;

      await prisma.drill.update({
        where: { id: drillId },
        data: {
          status: drill.status === 'ended_by_budget_guard' ? 'ended_by_budget_guard' : 'ended',
          transcript: transcript ?? drill.transcript ?? '',
          transcriptStatus,
          recordingUrl: recordingUrl ?? drill.recordingUrl,
          costUsd: drill.costUsd + vapiCost,
          endedAt: new Date(),
          vapiCallId: callId ?? drill.vapiCallId,
        },
      });

      if (vapiCost > 0) {
        await prisma.costRecord.create({
          data: {
            feature: `voice-drill:${drillId}`,
            model: 'vapi',
            inputTokens: 0,
            outputTokens: 0,
            estimatedCost: vapiCost,
            vapiCallId: callId ?? undefined,
            callDurationSeconds: fetched?.durationSeconds ?? undefined,
            vapiMinutes: fetched?.durationSeconds != null ? fetched.durationSeconds / 60 : undefined,
          },
        });
      }

      if (transcript) {
        await analyzeAndPersistVoiceMetrics(drillId, transcript, undefined, recordingUrl).catch(
          (err) => console.error('voice-quality analysis failed', err)
        );
      }

      emit(drillId, { type: 'call_ended', callId, costUsd: vapiCost });
      break;
    }

    default:
      // Unknown event types are tolerated.
      break;
  }

  return NextResponse.json({ ok: true });
}
