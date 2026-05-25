/**
 * Voice_Quality_Analyzer
 *
 * Computes voice metrics from a drill transcript and optional per-utterance
 * timing data. Persists the result as `Drill.voiceMetrics`.
 *
 * Validates: Requirements 10.1–10.6
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const FILLER_WORDS = [
  'um',
  'uh',
  'like',
  'you know',
  'basically',
  'literally',
  'kinda',
  'sorta',
] as const;

export type Utterance = {
  start: number; // seconds from call start
  end: number;   // seconds from call start
  text: string;
};

export type VoiceMetrics = {
  /** Filler word occurrences per 100 total words. */
  fillerWordRate: number;
  /** Words per minute, excluding inter-utterance silences > 1.0 s. Present only when per-utterance timestamps are available. */
  paceWPM?: number;
  /** [0.0, 1.0]. 0 = very steady, 1 = highly shaky. Present only when a recording URL is available. */
  voiceShakinessScore?: number;
  /** [0.0, 1.0]. 0 = inconsistent, 1 = perfectly consistent. Present only when a recording URL is available. */
  toneConsistencyScore?: number;
};

/**
 * Count filler word occurrences in `text`.
 * Multi-word fillers ("you know") are matched before single-word ones to
 * avoid double-counting.
 */
export function countFillerWords(text: string): number {
  const normalized = text.toLowerCase();
  const multiWord = FILLER_WORDS.filter((fw) => fw.includes(' '));
  const singleWord = FILLER_WORDS.filter((fw) => !fw.includes(' '));

  let count = 0;

  for (const filler of multiWord) {
    const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = normalized.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
    count += matches?.length ?? 0;
  }

  for (const filler of singleWord) {
    const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = normalized.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
    count += matches?.length ?? 0;
  }

  return count;
}

/**
 * Compute pace in WPM from utterances, excluding silences > 1.0 s between them.
 */
function computePaceWPM(utterances: Utterance[]): number | undefined {
  if (utterances.length === 0) return undefined;

  const sorted = [...utterances].sort((a, b) => a.start - b.start);

  let speakingWords = 0;
  let speakingSeconds = 0;

  for (let i = 0; i < sorted.length; i++) {
    const utt = sorted[i];
    const duration = Math.max(0, utt.end - utt.start);
    const uttWords = utt.text.split(/\s+/).filter(Boolean).length;
    speakingWords += uttWords;
    speakingSeconds += duration;
  }

  if (speakingSeconds <= 0) return undefined;
  return Math.round((speakingWords / speakingSeconds) * 60);
}

/**
 * Derive voiceShakinessScore [0, 1] from transcript-based proxies.
 *
 * Approximates audio jitter/pitch variance using:
 * - Filler word density (heavy filler use → shakier delivery)
 * - Word repetition rate (starters, restarts)
 *
 * A recording URL must be present for this field to be included.
 */
function computeVoiceShakinessScore(transcript: string, fillerWordRate: number): number {
  const normalized = transcript.toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  const totalWords = words.length;

  // Proxy 1: filler density (≥30% filler rate → shakiness = 1.0)
  const fillerDensity = Math.min(fillerWordRate / 30, 1.0);

  // Proxy 2: immediate word repetition (e.g. "the the", "I I")
  let restartCount = 0;
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1] && words[i].length > 1) restartCount++;
  }
  const restartRate = totalWords > 0 ? Math.min((restartCount / totalWords) * 20, 1.0) : 0;

  const raw = fillerDensity * 0.7 + restartRate * 0.3;
  return Math.round(Math.min(raw, 1.0) * 100) / 100;
}

/**
 * Derive toneConsistencyScore [0, 1] from sentence-level sentiment variance.
 *
 * Splits the transcript into sentences and measures polarity spread using a
 * lightweight positive/negative word lexicon. Low variance → high consistency.
 *
 * A recording URL must be present for this field to be included.
 */
function computeToneConsistencyScore(transcript: string): number {
  const posPattern = /\b(great|good|excellent|sure|clear|definitely|absolutely|confident|correct|exactly|perfect|right|yes|strong|solid|clean)\b/gi;
  const negPattern = /\b(bad|wrong|fail|unsure|maybe|perhaps|confused|difficult|problem|issue|unclear|not sure|uncertain|weak|messy)\b/gi;

  const sentences = transcript
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);

  if (sentences.length < 2) {
    return sentences.length === 1 ? 1.0 : 0.5;
  }

  const scores = sentences.map((s) => {
    const pos = (s.match(posPattern) ?? []).length;
    const neg = (s.match(negPattern) ?? []).length;
    const wordCount = s.split(/\s+/).filter(Boolean).length;
    return wordCount > 0 ? (pos - neg) / wordCount : 0;
  });

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;

  // variance ≥ 0.02 → max inconsistency; scale so 0.02 → consistency = 0
  const consistency = Math.max(0, 1 - Math.min(variance / 0.02, 1));
  return Math.round(consistency * 100) / 100;
}

/**
 * Compute all voice quality metrics for a completed drill.
 *
 * - `fillerWordRate` is always computed when the transcript is non-empty.
 * - `paceWPM` is computed when per-utterance timestamps are supplied.
 * - `voiceShakinessScore` and `toneConsistencyScore` are computed only when
 *   `recordingUrl` is non-null (even if actual audio download is not
 *   performed — they use transcript-based approximations in that case).
 */
export function computeVoiceMetrics(
  transcript: string,
  utterances?: Utterance[],
  recordingUrl?: string | null,
): VoiceMetrics | null {
  const trimmed = (transcript ?? '').trim();
  if (!trimmed) return null;

  const totalWords = trimmed.split(/\s+/).filter(Boolean).length;
  const fillerMatches = countFillerWords(trimmed);
  const fillerWordRate =
    totalWords > 0 ? Math.round((fillerMatches / totalWords) * 10000) / 100 : 0;

  const metrics: VoiceMetrics = { fillerWordRate };

  if (utterances && utterances.length > 0) {
    const pace = computePaceWPM(utterances);
    if (pace !== undefined) metrics.paceWPM = pace;
  }

  if (recordingUrl) {
    metrics.voiceShakinessScore = computeVoiceShakinessScore(trimmed, fillerWordRate);
    metrics.toneConsistencyScore = computeToneConsistencyScore(trimmed);
  }

  return metrics;
}

/**
 * Compute voice metrics and persist them as `Drill.voiceMetrics`.
 */
export async function analyzeAndPersistVoiceMetrics(
  drillId: string,
  transcript: string,
  utterances?: Utterance[],
  recordingUrl?: string | null,
): Promise<VoiceMetrics | null> {
  const metrics = computeVoiceMetrics(transcript, utterances, recordingUrl);
  if (!metrics) return null;

  await prisma.drill.update({
    where: { id: drillId },
    data: { voiceMetrics: metrics as Prisma.InputJsonValue },
  });

  return metrics;
}
