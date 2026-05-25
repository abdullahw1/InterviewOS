/**
 * Grading determinism property test (6.5)
 *
 * For a fixed (transcript, modelAnswers, rubric, gradingModel,
 * gradingPromptVersion) tuple, runs the grader 5 times with recorded
 * fixture responses and asserts per-question scores vary by ≤0.5.
 *
 * Uses mocks so no live OpenAI key is required.
 *
 * Validates: Requirement 11.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Prisma (no DB needed)
// ---------------------------------------------------------------------------
vi.mock('@/lib/prisma', () => ({
  prisma: {
    drillQuestion: { update: vi.fn().mockResolvedValue({}) },
    drill: { update: vi.fn().mockResolvedValue({}) },
    costRecord: { create: vi.fn().mockResolvedValue({}) },
  },
}));

// ---------------------------------------------------------------------------
// Fixture: pre-recorded LLM responses per question.
// Slight variation (≤0.3 pts) simulates real low-temperature LLM output.
// All values are within 0.5 of the baseline for the determinism assertion.
// ---------------------------------------------------------------------------

// Per-question fixture responses indexed by question id and run number.
const QUESTION_FIXTURES: Record<string, Array<{ score: number; feedback: string }>> = {
  q1: [
    { score: 3.5, feedback: 'Good explanation of the auth flow.' },
    { score: 3.7, feedback: 'Solid understanding shown.' },
    { score: 3.5, feedback: 'Correct but could mention caching.' },
    { score: 3.6, feedback: 'Clear explanation with examples.' },
    { score: 3.4, feedback: 'Good overall, minor gaps.' },
  ],
  q2: [
    { score: 2.0, feedback: 'Missing error handling discussion.' },
    { score: 2.2, feedback: 'Needs more depth on edge cases.' },
    { score: 1.9, feedback: 'Answer lacks specific file references.' },
    { score: 2.1, feedback: 'Partially correct, missing validation.' },
    { score: 2.0, feedback: 'Core concept correct but incomplete.' },
  ],
};

// Per-run call counters — tracks how many grading calls have been made for each run.
let runIndex = 0;
const callCounterPerRun: number[] = [0, 0, 0, 0, 0];

// Each run has: q1 grade, q2 grade, then weak-areas call (returns valid JSON but no scores).
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: { messages: { content: string }[] }) => {
            // Detect whether this is a question-grading or weak-areas call
            // by checking for "Candidate Answer" in the user message.
            const userContent = params.messages.find((m) => m.content.startsWith('Question:'))?.content ?? '';
            const isGradingCall = userContent.includes('Candidate Answer');

            if (!isGradingCall) {
              // Weak-areas / remediation call — return empty but valid JSON.
              return {
                choices: [{ message: { content: JSON.stringify({ weakAreas: [], remediation: [] }) } }],
                usage: { prompt_tokens: 80, completion_tokens: 30 },
              };
            }

            // Determine which question this is from the message content.
            const questionId = userContent.includes('requireUser') ? 'q1' : 'q2';
            const idx = Math.min(runIndex, 4);
            const fixture = QUESTION_FIXTURES[questionId][idx];

            return {
              choices: [{ message: { content: JSON.stringify(fixture) } }],
              usage: { prompt_tokens: 100, completion_tokens: 50 },
            };
          }),
        },
      },
    })),
  };
});

// Also mock cost-tracker so it doesn't need a real DB
vi.mock('@/lib/services/cost-tracker', () => ({
  trackedOpenAICall: vi.fn().mockImplementation(async (_feature, _model, apiCall) => {
    return apiCall();
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures for the test
// ---------------------------------------------------------------------------

import { GRADING_MODEL, GRADING_PROMPT_VERSION, gradeDrill } from '@/lib/services/drill/grader';
import type { QuestionForGrading } from '@/lib/services/drill/grader';

const FIXTURE_QUESTIONS: QuestionForGrading[] = [
  {
    id: 'q1',
    questionType: 'Code_Tracing',
    prompt: 'Explain what the `requireUser` function in src/lib/access.ts does and when it throws.',
    userAnswer:
      'The requireUser function retrieves the session from next-auth and throws an HttpError with status 401 if no session or user id is present. It is used by all route handlers to protect endpoints.',
    modelAnswer:
      'requireUser calls getServerSession with authOptions, throws HttpError(401) if session.user.id is missing, and returns a SessionUser object with id and email.',
    filePaths: ['src/lib/access.ts'],
    projectId: 'proj_abc',
  },
  {
    id: 'q2',
    questionType: 'Debugging',
    prompt: 'The webhook in src/app/api/drills/[id]/voice/webhook/route.ts returns 401. Why?',
    userAnswer: 'The signature does not match.',
    modelAnswer:
      'The route verifies the x-vapi-signature header as HMAC-SHA256 of the raw body using VAPI_WEBHOOK_SECRET. A mismatch returns 401 and writes nothing to the database.',
    filePaths: ['src/app/api/drills/[id]/voice/webhook/route.ts'],
    projectId: 'proj_abc',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GRADING_MODEL and GRADING_PROMPT_VERSION are pinned', () => {
  it('uses gpt-4o-mini as the grading model', () => {
    expect(GRADING_MODEL).toBe('gpt-4o-mini');
  });

  it('uses v1 as the grading prompt version', () => {
    expect(GRADING_PROMPT_VERSION).toBe('v1');
  });
});

describe('Drill_Grader determinism (6.5)', () => {
  beforeEach(() => {
    runIndex = 0;
    callCounterPerRun.fill(0);
  });

  it('produces per-question scores varying by ≤0.5 across 5 fixture runs', async () => {
    const results = [];

    for (let run = 0; run < 5; run++) {
      runIndex = run;
      const result = await gradeDrill('drill_test', FIXTURE_QUESTIONS);
      results.push(result);
    }

    // Every run must have the same number of graded questions
    for (const result of results) {
      expect(result.gradedQuestions).toHaveLength(FIXTURE_QUESTIONS.length);
    }

    // Per-question: score must vary by ≤0.5 from the first run
    const baseline = results[0].gradedQuestions;
    for (let run = 1; run < results.length; run++) {
      for (let qi = 0; qi < baseline.length; qi++) {
        const baseScore = baseline[qi].score;
        const runScore = results[run].gradedQuestions[qi].score;
        const delta = Math.abs(runScore - baseScore);
        expect(
          delta,
          `Run ${run + 1}, Q${qi + 1}: score ${runScore} vs baseline ${baseScore} (delta ${delta} > 0.5)`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('overall score is arithmetic mean of per-question scores rounded to 1 decimal', async () => {
    const result = await gradeDrill('drill_test', FIXTURE_QUESTIONS);

    const computedMean =
      Math.round(
        (result.gradedQuestions.reduce((s, q) => s + q.score, 0) /
          result.gradedQuestions.length) *
          10,
      ) / 10;

    expect(result.overallScore).toBe(computedMean);
  });

  it('scores are within [0.0, 5.0]', async () => {
    const result = await gradeDrill('drill_test', FIXTURE_QUESTIONS);
    for (const q of result.gradedQuestions) {
      expect(q.score).toBeGreaterThanOrEqual(0);
      expect(q.score).toBeLessThanOrEqual(5);
    }
  });

  it('returns empty result for questions without answers', async () => {
    const unanswered: QuestionForGrading[] = FIXTURE_QUESTIONS.map((q) => ({
      ...q,
      userAnswer: '',
    }));
    const result = await gradeDrill('drill_test', unanswered);
    expect(result.gradedQuestions).toHaveLength(0);
    expect(result.overallScore).toBe(0);
  });
});
