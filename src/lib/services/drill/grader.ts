/**
 * Drill_Grader
 *
 * Grades all answered DrillQuestions for a completed drill, computes the
 * overall score, identifies 0–5 weak areas, and produces a 0–3 file-path
 * remediation list.
 *
 * Validates: Requirements 11.1–11.7
 */

import { prisma } from '@/lib/prisma';
import { chatWithClaude, CLAUDE_MODEL } from '@/lib/claude';
import { Prisma } from '@prisma/client';

/** Pinned — changing this constant invalidates cached grade comparisons. */
export const GRADING_MODEL = CLAUDE_MODEL;
/** Increment when the grading prompt changes semantically. */
export const GRADING_PROMPT_VERSION = 'v2';

export type GradedQuestion = {
  questionId: string;
  score: number;    // [0.0, 5.0], rounded to 1 decimal
  feedback: string;
};

export type WeakArea = {
  projectId?: string;
  topic: string;
  filePaths: string[]; // at least one file path from the File_Index
};

export type GradeResult = {
  gradedQuestions: GradedQuestion[];
  overallScore: number;   // arithmetic mean of per-question scores, rounded to 1 decimal
  weakAreas: WeakArea[];  // 0–5 entries
  remediation: string[];  // 0–3 file paths ranked by relevance to weak areas
};

export type QuestionForGrading = {
  id: string;
  questionType: string;
  prompt: string;
  userAnswer: string;
  modelAnswer?: string | null;
  filePaths: string[];
  projectId?: string | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildQuestionGradingPrompt(q: QuestionForGrading): string {
  return [
    `gradingModel=${GRADING_MODEL} gradingPromptVersion=${GRADING_PROMPT_VERSION}`,
    '',
    'You are an expert technical interview grader.',
    `Question type: ${q.questionType}`,
    `Referenced files: ${q.filePaths.join(', ') || 'None'}`,
    q.modelAnswer ? `\nModel answer:\n${q.modelAnswer}` : '',
    '',
    'Score the candidate answer 0.0–5.0:',
    '  0–1  Completely wrong or irrelevant',
    '  1–2  Shows some understanding but major gaps',
    '  2–3  Adequate but missing key details',
    '  3–4  Good answer with minor gaps',
    '  4–5  Excellent and comprehensive',
    q.modelAnswer
      ? '\nInclude up to 1.0 bonus points for similarity to the model answer.'
      : '',
    '',
    'Respond ONLY as JSON: { "score": 3.5, "feedback": "..." }',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

async function gradeOneQuestion(
  drillId: string,
  q: QuestionForGrading,
): Promise<GradedQuestion> {
  const systemPrompt = buildQuestionGradingPrompt(q);
  const userContent = `Question: ${q.prompt}\n\nCandidate Answer: ${q.userAnswer}`;

  try {
    const raw = await chatWithClaude({
      feature: `drill-grade:${drillId}`,
      systemPrompt,
      userMessage: userContent,
      maxTokens: 600,
      json: true,
    });
    const parsed = JSON.parse(raw) as { score?: unknown; feedback?: unknown };
    const score = Math.max(0, Math.min(5, Number(parsed.score) || 0));
    const feedback =
      typeof parsed.feedback === 'string' ? parsed.feedback : 'No feedback provided.';

    return {
      questionId: q.id,
      score: Math.round(score * 10) / 10,
      feedback,
    };
  } catch {
    return { questionId: q.id, score: 0, feedback: 'Grading failed.' };
  }
}

async function identifyWeakAreasAndRemediation(
  drillId: string,
  questions: QuestionForGrading[],
  grades: GradedQuestion[],
): Promise<{ weakAreas: WeakArea[]; remediation: string[] }> {
  const poorGrades = grades.filter((g) => g.score < 3.0);
  if (poorGrades.length === 0) return { weakAreas: [], remediation: [] };

  const weakQuestions = poorGrades
    .map((g) => {
      const q = questions.find((q) => q.id === g.questionId)!;
      return { ...q, score: g.score };
    })
    .filter(Boolean);

  const systemPrompt = [
    `gradingModel=${GRADING_MODEL} gradingPromptVersion=${GRADING_PROMPT_VERSION}`,
    '',
    'You are an expert technical interviewer analyzing performance gaps.',
    '',
    'Given weak answers, identify 0–5 distinct weak areas and 0–3 remediation file paths.',
    '',
    'Each weak area MUST:',
    '  - Name a specific topic (e.g. "Error handling in auth middleware")',
    '  - Contain at least one file path taken verbatim from the filePaths arrays below',
    '  - Optionally include a projectId',
    '',
    'Remediation must be 0–3 file paths ranked by relevance to the identified weak areas.',
    '',
    'Respond ONLY as JSON:',
    '{',
    '  "weakAreas": [{ "topic": "...", "filePaths": ["..."], "projectId": "..." }],',
    '  "remediation": ["src/lib/auth.ts"]',
    '}',
  ].join('\n');

  const body = weakQuestions
    .map(
      (q) =>
        `Type: ${q.questionType} | Score: ${q.score}/5.0\nFiles: ${q.filePaths.join(', ')}\nProjectId: ${q.projectId ?? 'N/A'}\nQuestion: ${q.prompt.slice(0, 300)}`,
    )
    .join('\n\n---\n\n');

  try {
    const raw = await chatWithClaude({
      feature: `drill-grade:${drillId}`,
      systemPrompt,
      userMessage: `Weak questions:\n\n${body}`,
      maxTokens: 800,
      json: true,
    });
    const parsed = JSON.parse(raw) as {
      weakAreas?: unknown[];
      remediation?: unknown[];
    };

    const weakAreas: WeakArea[] = (Array.isArray(parsed.weakAreas)
      ? parsed.weakAreas
      : []
    )
      .slice(0, 5)
      .map((wa) => {
        const obj = wa as Record<string, unknown>;
        return {
          topic: typeof obj.topic === 'string' ? obj.topic : 'Unknown area',
          filePaths: Array.isArray(obj.filePaths)
            ? (obj.filePaths as unknown[]).filter((fp): fp is string => typeof fp === 'string')
            : [],
          ...(typeof obj.projectId === 'string' ? { projectId: obj.projectId } : {}),
        };
      })
      .filter((wa) => wa.filePaths.length > 0);

    const remediation: string[] = (Array.isArray(parsed.remediation)
      ? (parsed.remediation as unknown[]).filter((fp): fp is string => typeof fp === 'string')
      : []
    ).slice(0, 3);

    return { weakAreas, remediation };
  } catch {
    const fallbackWeakAreas: WeakArea[] = weakQuestions
      .slice(0, 5)
      .filter((q) => q.filePaths.length > 0)
      .map((q) => ({
        topic: q.questionType.replace(/_/g, ' '),
        filePaths: q.filePaths.slice(0, 2),
        ...(q.projectId ? { projectId: q.projectId } : {}),
      }));

    const fallbackRemediation = [
      ...new Set(weakQuestions.flatMap((q) => q.filePaths)),
    ].slice(0, 3);

    return { weakAreas: fallbackWeakAreas, remediation: fallbackRemediation };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function gradeDrill(
  drillId: string,
  questions: QuestionForGrading[],
): Promise<GradeResult> {
  const answered = questions.filter((q) => q.userAnswer?.trim());
  if (answered.length === 0) {
    return { gradedQuestions: [], overallScore: 0, weakAreas: [], remediation: [] };
  }

  const gradedQuestions: GradedQuestion[] = [];
  for (const q of answered) {
    const result = await gradeOneQuestion(drillId, q);
    gradedQuestions.push(result);
  }

  const sum = gradedQuestions.reduce((acc, g) => acc + g.score, 0);
  const overallScore = Math.round((sum / gradedQuestions.length) * 10) / 10;

  const { weakAreas, remediation } = await identifyWeakAreasAndRemediation(
    drillId,
    answered,
    gradedQuestions,
  );

  return { gradedQuestions, overallScore, weakAreas, remediation };
}

export async function persistGradeResult(
  drillId: string,
  result: GradeResult,
): Promise<void> {
  await Promise.all(
    result.gradedQuestions.map((g) =>
      prisma.drillQuestion.update({
        where: { id: g.questionId },
        data: { score: g.score, feedback: g.feedback },
      }),
    ),
  );

  await prisma.drill.update({
    where: { id: drillId },
    data: {
      overallScore: result.overallScore,
      weakAreas: result.weakAreas as Prisma.InputJsonValue,
      remediation: result.remediation as Prisma.InputJsonValue,
      status: 'ended',
      endedAt: new Date(),
    },
  });
}
