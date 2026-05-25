'use client';

/**
 * VoiceDrill — client component that runs a Vapi voice interview.
 *
 * On mount, calls `POST /api/drills/[id]/voice/start` to get a Vapi
 * public key plus a single-use ephemeral token (the orchestrator already
 * registered the assistant + minted the call), then starts the Vapi Web
 * SDK with that token. Renders:
 *   - Live transcript pane (subscribed to vapi.on('message'))
 *   - Mute / End Call / Hint / Skip Question / Difficulty switch controls
 *   - Files in Discussion panel (subscribed to /voice/sse `chunk_used` events)
 *   - Running estimated cost meter (elapsed seconds × per-minute rate / 60)
 *
 * Terminates the call client-side via `vapi.stop()` once
 * `elapsedMinutes >= maxDrillVapiMinutes`.
 *
 * Validates: Requirements 9.6, 12.4, 12.5, 20.1
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Vapi from '@vapi-ai/web';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FileCode2,
  HelpCircle,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  SkipForward,
} from 'lucide-react';
import { toast } from 'sonner';

type TranscriptLine = { role: 'user' | 'assistant'; text: string; final: boolean };

type FileInDiscussion = {
  repoName: string;
  query?: string;
  filePaths: string[];
  at?: string;
};

type StartResponse = {
  drillId: string;
  assistantId?: string;
  webCallUrl: string;
  vapiPublicKey: string;
  callId?: string | null;
  maxDrillVapiMinutes: number;
  vapiPerMinuteRate: number;
};

type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Staff';

const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Staff'];

export function VoiceDrill({ drillId }: { drillId: string }) {
  const router = useRouter();
  const vapiRef = useRef<Vapi | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const perMinuteRateRef = useRef(0.1);
  const maxMinutesRef = useRef(20);
  const endedRef = useRef(false);

  const [status, setStatus] = useState<'idle' | 'starting' | 'connected' | 'ended' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState('');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [muted, setMuted] = useState(false);
  const [files, setFiles] = useState<FileInDiscussion[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [maxMinutes, setMaxMinutes] = useState(20);
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium');

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const endCall = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    try {
      vapiRef.current?.stop();
    } catch {
      // ignore
    }
    setStatus('ended');
    cleanup();
  }, [cleanup]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStatus('starting');
      try {
        const res = await fetch(`/api/drills/${drillId}/voice/start`, { method: 'POST' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to start (${res.status})`);
        }
        const data = (await res.json()) as StartResponse;
        if (cancelled) return;

        if (!data.vapiPublicKey) {
          throw new Error('VAPI_PUBLIC_KEY is not configured on the server.');
        }
        if (!data.webCallUrl) {
          throw new Error('Server did not return a webCallUrl.');
        }

        setMaxMinutes(data.maxDrillVapiMinutes);
        maxMinutesRef.current = data.maxDrillVapiMinutes;
        perMinuteRateRef.current = data.vapiPerMinuteRate ?? 0.1;

        const vapi = new Vapi(data.vapiPublicKey);
        vapiRef.current = vapi;

        vapi.on('call-start', () => {
          startTimeRef.current = Date.now();
          setStatus('connected');

          // Open SSE stream for tool/chunk events.
          const es = new EventSource(`/api/drills/${drillId}/voice/sse`);
          eventSourceRef.current = es;
          es.addEventListener('chunk_used', (ev: MessageEvent) => {
            try {
              const payload = JSON.parse(ev.data) as FileInDiscussion;
              setFiles((prev) => [payload, ...prev].slice(0, 20));
            } catch {
              // ignore
            }
          });
        });

        vapi.on('call-end', () => {
          endedRef.current = true;
          setStatus('ended');
          cleanup();
        });

        vapi.on('error', (err: unknown) => {
          console.error('Vapi error', err);
          const msg = err instanceof Error ? err.message : 'Vapi error';
          setErrorMsg(msg);
          setStatus('error');
        });

        vapi.on('message', (message: Record<string, unknown>) => {
          const type = message.type as string | undefined;
          if (type !== 'transcript') return;
          const role = (message.role as string) === 'user' ? 'user' : 'assistant';
          const text = (message.transcript as string) ?? '';
          const transcriptType = message.transcriptType as string | undefined;
          const isFinal = transcriptType === 'final';
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && !last.final && last.role === role) {
              const next = prev.slice(0, -1);
              next.push({ role, text, final: isFinal });
              return next;
            }
            return [...prev, { role, text, final: isFinal }];
          });
        });

        // Join the pre-created Vapi call. The server already ran
        // POST /call/web, so we reconnect to the Daily room it returned
        // rather than letting the SDK create a second call.
        await vapi.reconnect({ webCallUrl: data.webCallUrl, id: data.callId ?? undefined });

        // Elapsed tick + max-duration termination + cost calculation.
        tickRef.current = setInterval(() => {
          if (!startTimeRef.current) return;
          const sec = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setElapsedSec(sec);
          if (sec >= maxMinutesRef.current * 60 && !endedRef.current) {
            toast.info(
              `Reached the per-drill ${maxMinutesRef.current}-minute cap. Ending call.`,
            );
            endCall();
          }
        }, 1000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to start';
        console.error(msg);
        setErrorMsg(msg);
        setStatus('error');
      }
    }

    void start();

    return () => {
      cancelled = true;
      try {
        vapiRef.current?.stop();
      } catch {
        // ignore
      }
      cleanup();
    };
  }, [drillId, cleanup, endCall]);

  function toggleMute() {
    if (!vapiRef.current) return;
    const next = !muted;
    try {
      vapiRef.current.setMuted(next);
      setMuted(next);
    } catch {
      // ignore
    }
  }

  function sendHint() {
    if (!vapiRef.current) return;
    try {
      vapiRef.current.send({
        type: 'add-message',
        message: {
          role: 'user',
          content:
            "I'd like a hint for the current question — give me one nudge without revealing the full answer.",
        },
        triggerResponseEnabled: true,
      });
      toast.success('Asked for a hint');
    } catch (err) {
      console.error('Hint send failed', err);
    }
  }

  function skipQuestion() {
    if (!vapiRef.current) return;
    try {
      vapiRef.current.send({
        type: 'add-message',
        message: {
          role: 'user',
          content:
            "Let's skip this question and move on to the next one.",
        },
        triggerResponseEnabled: true,
      });
      toast.success('Skipping to the next question');
    } catch (err) {
      console.error('Skip send failed', err);
    }
  }

  function switchDifficulty(next: Difficulty) {
    if (!vapiRef.current || next === difficulty) return;
    setDifficulty(next);
    try {
      vapiRef.current.send({
        type: 'add-message',
        message: {
          role: 'system',
          content: `The candidate has switched the difficulty tier to ${next}. Adjust subsequent questions accordingly.`,
        },
        triggerResponseEnabled: false,
      });
      toast.success(`Difficulty: ${next}`);
    } catch (err) {
      console.error('Difficulty switch failed', err);
    }
  }

  const minutesElapsed = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const elapsedMinutesFloat = elapsedSec / 60;
  const costUsd = elapsedMinutesFloat * perMinuteRateRef.current;

  if (status === 'starting' || status === 'idle') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin mx-auto" />
          <p className="text-lg">Starting voice drill...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">Could not start drill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">{errorMsg}</p>
            <Button onClick={() => router.push('/drill/new')}>Back to drill setup</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold">Voice Drill</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {status === 'connected'
              ? `Live — ${minutesElapsed}m ${seconds}s elapsed (cap ${maxMinutes}m)`
              : status === 'ended'
                ? 'Call ended'
                : status}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            ${costUsd.toFixed(3)}
          </Badge>
          {status === 'connected' && (
            <>
              <Button
                size="sm"
                variant={muted ? 'outline' : 'default'}
                onClick={toggleMute}
              >
                {muted ? <MicOff className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
                {muted ? 'Unmute' : 'Mute'}
              </Button>
              <Button size="sm" variant="outline" onClick={sendHint}>
                <HelpCircle className="w-4 h-4 mr-2" />
                Hint
              </Button>
              <Button size="sm" variant="outline" onClick={skipQuestion}>
                <SkipForward className="w-4 h-4 mr-2" />
                Skip
              </Button>
              <Button size="sm" variant="destructive" onClick={endCall}>
                <PhoneOff className="w-4 h-4 mr-2" />
                End Call
              </Button>
            </>
          )}
          {status === 'ended' && (
            <Button onClick={() => router.push(`/drill/${drillId}`)}>View Report</Button>
          )}
        </div>
      </div>

      {status === 'connected' && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-xs uppercase tracking-wide text-gray-500 mr-2">
              Difficulty
            </span>
            {DIFFICULTIES.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={difficulty === d ? 'default' : 'outline'}
                onClick={() => switchDifficulty(d)}
              >
                {d}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Live Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[60vh] overflow-y-auto space-y-3 text-sm">
              {transcript.length === 0 ? (
                <p className="text-gray-500">Listening... say hello to your interviewer.</p>
              ) : (
                transcript.map((line, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-md ${
                      line.role === 'user'
                        ? 'bg-blue-50 dark:bg-blue-900/30'
                        : 'bg-gray-50 dark:bg-gray-800'
                    }`}
                  >
                    <span className="text-xs font-semibold text-gray-500 mr-2">
                      {line.role === 'user' ? 'You' : 'Interviewer'}
                    </span>
                    {line.text}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4" />
              Files in Discussion
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[60vh] overflow-y-auto text-sm space-y-2">
              {files.length === 0 ? (
                <p className="text-gray-500">No files referenced yet.</p>
              ) : (
                files.map((f, idx) => (
                  <div key={idx} className="border-l-2 border-blue-500 pl-3">
                    <div className="text-xs text-gray-500">
                      {f.repoName ?? 'repo'}
                      {f.query ? ` · ${f.query}` : ''}
                    </div>
                    <ul className="font-mono text-xs">
                      {f.filePaths.map((fp) => (
                        <li key={fp}>{fp}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
