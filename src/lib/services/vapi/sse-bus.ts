/**
 * In-memory SSE event bus for per-drill voice events.
 *
 * Module-level singleton. Routes call `emit(drillId, event)` to fan out
 * to anyone holding `on(drillId, listener)`. This is process-local;
 * suitable for the single-instance dev/prod setup. Replace with a Redis
 * pub/sub if multi-instance deploys are needed.
 */

import { EventEmitter } from 'events';

export type SSEEvent =
  | { type: 'chunk_used'; filePaths: string[]; repoName: string; query?: string; at?: string }
  | { type: 'tool_call'; callId?: string | null }
  | { type: 'call_started'; callId?: string | null }
  | { type: 'call_ended'; callId?: string | null; costUsd?: number };

const buses = new Map<string, EventEmitter>();

function getEmitter(drillId: string): EventEmitter {
  let emitter = buses.get(drillId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    buses.set(drillId, emitter);
  }
  return emitter;
}

/**
 * Emit an SSE event to every listener subscribed for this drill.
 */
export function emit(drillId: string, event: SSEEvent): void {
  getEmitter(drillId).emit('event', event);
}

/**
 * Subscribe to SSE events for a drill. Returns an unsubscribe function.
 */
export function on(
  drillId: string,
  listener: (event: SSEEvent) => void
): () => void {
  const emitter = getEmitter(drillId);
  emitter.on('event', listener);
  return () => {
    emitter.off('event', listener);
    if (emitter.listenerCount('event') === 0) {
      buses.delete(drillId);
    }
  };
}

// Backwards-compatible aliases — earlier callers used publish/subscribe.
export const publish = emit;
export const subscribe = on;

export default { emit, on, publish, subscribe };
