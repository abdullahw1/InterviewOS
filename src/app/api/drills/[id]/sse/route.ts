/**
 * GET /api/drills/[id]/sse
 *
 * Server-Sent Events stream for the in-call drill UI. The client opens an
 * `EventSource` against this endpoint and receives `chunk_used` (and other)
 * events emitted on the per-drill in-memory bus by the voice tool and
 * webhook handlers.
 *
 * Auth:
 *   - `requireUser` — must be a signed-in user.
 *   - The drill must belong to that user.
 *   - `assertProjectsOwnedBy` — every Project id in the drill's
 *     `configJson.selectedRepos` must also belong to the same user.
 *
 * Wire format:
 *   data: {"type":"chunk_used", ...}\n\n
 *
 * Plus a `:` keep-alive comment line every 15 seconds so the connection
 * doesn't get reaped by intermediate proxies.
 *
 * Validates: Requirements 9.5, 20.2, 20.6
 */

import { NextRequest } from 'next/server';

import { assertProjectsOwnedBy, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { on, type SSEEvent } from '@/lib/services/vapi/sse-bus';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const KEEPALIVE_INTERVAL_MS = 15_000;

export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { id: drillId } = await ctx.params;

  let user;
  try {
    user = await requireUser(req);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const drill = await prisma.drill.findUnique({
    where: { id: drillId },
    select: { userId: true, configJson: true },
  });
  if (!drill || drill.userId !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  const config = drill.configJson as unknown as { selectedRepos?: string[] };
  const selectedRepos = Array.isArray(config?.selectedRepos) ? config.selectedRepos : [];
  try {
    await assertProjectsOwnedBy(user.id, selectedRepos);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Initial comment to flush headers down to the client.
      controller.enqueue(encoder.encode(': connected\n\n'));

      const writeEvent = (event: SSEEvent) => {
        try {
          const line = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(line));
        } catch {
          // Stream closed; cleanup is handled by abort.
        }
      };

      const unsubscribe = on(drillId, writeEvent);

      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          // Closed; nothing to do.
        }
      }, KEEPALIVE_INTERVAL_MS);

      const abort = () => {
        clearInterval(interval);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      req.signal.addEventListener('abort', abort);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
