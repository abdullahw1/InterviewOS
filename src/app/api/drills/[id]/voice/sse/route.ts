/**
 * GET /api/drills/[id]/voice/sse
 *
 * Server-Sent Events stream for the per-drill voice UI. Emits events
 * published on the in-memory SSE bus by the fetch-code-chunk endpoint
 * and webhook handler.
 *
 * Validates: Requirements 9.5
 */

import { NextRequest } from 'next/server';

import { requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { subscribe } from '@/lib/services/vapi/sse-bus';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { id: drillId } = await ctx.params;

  let user;
  try {
    user = await requireUser(req);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const drill = await prisma.drill.findUnique({ where: { id: drillId } });
  if (!drill || drill.userId !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Initial comment to flush headers
      controller.enqueue(encoder.encode(': connected\n\n'));

      const unsubscribe = subscribe(drillId, (event) => {
        try {
          const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // ignore
        }
      });

      // Keep-alive ping every 20s
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(interval);
          unsubscribe();
        }
      }, 20000);

      const abort = () => {
        clearInterval(interval);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
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
    },
  });
}
