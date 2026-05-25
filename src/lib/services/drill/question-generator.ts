/**
 * Text drill question generator.
 *
 * Given a Drill_Config, retrieves up to 10 chunks from the selected
 * Projects' File_Index ranked by relevance to the chosen questionTypes,
 * and produces `questionCount` questions. Non-Behavioral questions must
 * reference at least one file path from the File_Index. Behavioral
 * questions prefer the user's Question_Bank entries over LLM-generated
 * ones; the Resume_Profile and linkedinHighlights are included in the
 * system prompt when Behavioral is in the type set.
 *
 * Validates: Requirements 8.1–8.4, 13.4, 20.3
 */

import { prisma } from '@/lib/prisma';
import { chatCompletion } from '@/lib/llm';
import { getBudgetCaps } from '@/lib/access';

export type DrillConfig = {
  lengthMinutes: number;
  questionCount: number;
  repoScope: 'Single' | 'Multi' | 'Whole_Portfolio';
  selectedRepos: string[];
  difficultyTier: 'Easy' | 'Medium' | 'Hard' | 'Staff';
  questionTypes: Array<
    | 'Code_Tracing'
    | 'Modification'
    | 'Design_Rationale'
    | 'Debugging'
    | 'Tradeoffs'
    | 'Scaling'
    | 'Security'
    | 'Behavioral'
  >;
  persona: 'Friendly_Mentor' | 'Staff_Engineer' | 'Hostile' | 'Startup_Founder';
};

export type GeneratedQuestion = {
  questionType: string;
  prompt: string;
  modelAnswer: string | null;
  filePaths: string[];
  projectId: string | null;
};

/**
 * Get the current total cost for a text drill.
 */
export async function getDrillCost(drillId: string): Promise<number> {
  const rows = await prisma.costRecord.findMany({
    where: { feature: `text-drill:${drillId}` },
    select: { estimatedCost: true },
  });
  return rows.reduce((sum, r) => sum + r.estimatedCost, 0);
}

/**
 * Check if the drill has exceeded its cost cap.
 */
export async function isDrillCostCapped(drillId: string): Promise<boolean> {
  const caps = getBudgetCaps();
  const currentCost = await getDrillCost(drillId);
  return currentCost >= caps.maxTextDrillCostUsd;
}

/**
 * Retrieve relevant chunks from the selected projects.
 * Vector search is skipped because pgvector is not available on the current DB;
 * chunks are returned in creation order so question generation still has real code context.
 */
async function retrieveRelevantChunks(
  projectIds: string[],
  _questionTypes: string[],
  _drillId: string
): Promise<Array<{ id: string; filePath: string; content: string; projectId: string | null }>> {
  if (projectIds.length === 0) return [];

  const results = await prisma.projectChunk.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, filePath: true, content: true, projectId: true },
    take: 10,
    orderBy: { createdAt: 'asc' },
  });

  return results;
}

/**
 * Generate questions for a text drill.
 */
export async function generateQuestions(
  drillId: string,
  config: DrillConfig,
  userId: string
): Promise<GeneratedQuestion[]> {
  const questions: GeneratedQuestion[] = [];

  // Separate behavioral from non-behavioral types
  const hasBehavioral = config.questionTypes.includes('Behavioral');
  const nonBehavioralTypes = config.questionTypes.filter((t) => t !== 'Behavioral');

  // Calculate how many of each type
  let behavioralCount = 0;
  let nonBehavioralCount = config.questionCount;

  if (hasBehavioral && nonBehavioralTypes.length > 0) {
    // Split proportionally
    behavioralCount = Math.ceil(config.questionCount / config.questionTypes.length);
    nonBehavioralCount = config.questionCount - behavioralCount;
  } else if (hasBehavioral && nonBehavioralTypes.length === 0) {
    behavioralCount = config.questionCount;
    nonBehavioralCount = 0;
  }

  // --- Handle Behavioral questions (prefer Question_Bank) ---
  if (behavioralCount > 0) {
    const bankEntries = await prisma.questionBankEntry.findMany({
      where: {
        userId,
        questionType: 'Behavioral',
        difficultyTier: config.difficultyTier,
      },
      take: behavioralCount,
      orderBy: { createdAt: 'desc' },
    });

    // Use bank entries first
    for (const entry of bankEntries) {
      if (questions.length >= behavioralCount) break;
      questions.push({
        questionType: 'Behavioral',
        prompt: entry.prompt,
        modelAnswer: entry.modelAnswer,
        filePaths: [],
        projectId: null,
      });
    }

    // If we need more behavioral questions, generate with LLM
    const remainingBehavioral = behavioralCount - questions.length;
    if (remainingBehavioral > 0) {
      // Check cost cap before LLM call
      if (await isDrillCostCapped(drillId)) {
        return questions;
      }

      // Get resume context for behavioral questions
      const resumeProfile = await prisma.resumeProfile.findUnique({
        where: { userId },
      });

      const resumeContext = resumeProfile?.resumeText
        ? `\nCandidate Resume:\n${resumeProfile.resumeText.slice(0, 1500)}`
        : '';
      const linkedinContext =
        resumeProfile?.linkedinHighlights &&
        Array.isArray(resumeProfile.linkedinHighlights) &&
        (resumeProfile.linkedinHighlights as string[]).length > 0
          ? `\nLinkedIn Highlights:\n${(resumeProfile.linkedinHighlights as string[]).join('\n')}`
          : '';

      const systemPrompt = `You are an expert interviewer generating behavioral interview questions.
Difficulty: ${config.difficultyTier}
Persona: ${config.persona.replace(/_/g, ' ')}
${resumeContext}
${linkedinContext}

Generate ${remainingBehavioral} behavioral interview question(s) using the STAR method format.
Each question should probe leadership, teamwork, conflict resolution, or technical decision-making.
Respond as JSON: { "questions": [{ "prompt": "...", "modelAnswer": "..." }] }`;

      try {
        const content = await chatCompletion({
          systemPrompt,
          userMessage: 'Generate the behavioral questions now.',
          maxTokens: 1500,
          json: true,
        });
        const parsed = JSON.parse(content);
        const generated = Array.isArray(parsed.questions) ? parsed.questions : [];
        for (const q of generated.slice(0, remainingBehavioral)) {
          questions.push({
            questionType: 'Behavioral',
            prompt: q.prompt || 'Tell me about a challenging situation you faced.',
            modelAnswer: q.modelAnswer || null,
            filePaths: [],
            projectId: null,
          });
        }
      } catch (err) {
        console.error('Behavioral question generation error:', err);
        questions.push({
          questionType: 'Behavioral',
          prompt: 'Tell me about a time you had to make a difficult technical decision. What was the context, and how did you approach it?',
          modelAnswer: null,
          filePaths: [],
          projectId: null,
        });
      }
    }
  }

  // --- Handle non-Behavioral questions (must reference file paths) ---
  if (nonBehavioralCount > 0) {
    // Check cost cap
    if (await isDrillCostCapped(drillId)) {
      return questions;
    }

    // Retrieve relevant chunks
    const chunks = await retrieveRelevantChunks(
      config.selectedRepos,
      nonBehavioralTypes,
      drillId
    );

    if (chunks.length === 0) {
      // No chunks available — can't generate code-grounded questions
      return questions;
    }

    // Check cost cap again after embedding call
    if (await isDrillCostCapped(drillId)) {
      return questions;
    }

    // Get project summaries for context
    const summaries = await prisma.projectSummary.findMany({
      where: { projectId: { in: config.selectedRepos } },
      select: { projectId: true, description: true, techStack: true },
    });

    const summaryContext = summaries
      .map((s) => `Project: ${s.description}\nTech: ${JSON.stringify(s.techStack)}`)
      .join('\n\n');

    const chunkContext = chunks
      .map((c) => `--- ${c.filePath} ---\n${c.content.slice(0, 800)}`)
      .join('\n\n');

    // Distribute question types evenly
    const typeDistribution: string[] = [];
    for (let i = 0; i < nonBehavioralCount; i++) {
      typeDistribution.push(nonBehavioralTypes[i % nonBehavioralTypes.length]);
    }

    const systemPrompt = `You are an expert technical interviewer.
Difficulty: ${config.difficultyTier}
Persona: ${config.persona.replace(/_/g, ' ')}

Project Context:
${summaryContext}

Code Context (from the candidate's actual codebase):
${chunkContext}

Generate exactly ${nonBehavioralCount} interview question(s) with these types: ${typeDistribution.join(', ')}.

CRITICAL RULES:
- Each question MUST reference at least one specific file path from the code context above.
- Questions should test deep understanding of the actual code shown.
- Include a model answer for each question.
- The filePaths array must contain real file paths from the context.

Respond as JSON:
{
  "questions": [
    {
      "questionType": "Code_Tracing",
      "prompt": "Looking at src/lib/auth.ts, ...",
      "modelAnswer": "The function...",
      "filePaths": ["src/lib/auth.ts"],
      "projectId": "project-id-or-null"
    }
  ]
}`;

    try {
      const content = await chatCompletion({
        systemPrompt,
        userMessage: `Generate ${nonBehavioralCount} questions now. Available file paths: ${[...new Set(chunks.map((c) => c.filePath))].join(', ')}`,
        maxTokens: 3000,
        json: true,
      });

      const parsed = JSON.parse(content);
      const generated = Array.isArray(parsed.questions) ? parsed.questions : [];
      const validFilePaths = new Set(chunks.map((c) => c.filePath));

      for (const q of generated.slice(0, nonBehavioralCount)) {
        let filePaths: string[] = Array.isArray(q.filePaths) ? q.filePaths : [];
        filePaths = filePaths.filter((fp: string) => validFilePaths.has(fp));
        if (filePaths.length === 0 && chunks.length > 0) {
          filePaths = [chunks[0].filePath];
        }

        let projectId: string | null = null;
        if (filePaths.length > 0) {
          const matchingChunk = chunks.find((c) => c.filePath === filePaths[0]);
          projectId = matchingChunk?.projectId ?? null;
        }

        const questionType =
          q.questionType && typeDistribution.includes(q.questionType)
            ? q.questionType
            : typeDistribution[questions.length - behavioralCount] ?? nonBehavioralTypes[0];

        questions.push({
          questionType,
          prompt: q.prompt || `Explain the implementation in ${filePaths[0]}`,
          modelAnswer: q.modelAnswer || null,
          filePaths,
          projectId,
        });
      }
    } catch (err) {
      console.error('Non-behavioral question generation error:', err);
      for (let i = 0; i < Math.min(nonBehavioralCount, chunks.length); i++) {
        const chunk = chunks[i];
        questions.push({
          questionType: nonBehavioralTypes[i % nonBehavioralTypes.length],
          prompt: `Explain the code in ${chunk.filePath} and describe its role in the system.`,
          modelAnswer: null,
          filePaths: [chunk.filePath],
          projectId: chunk.projectId,
        });
      }
    }
  }

  return questions.slice(0, config.questionCount);
}

/**
 * Grade a single text drill answer.
 */
export async function gradeAnswer(
  drillId: string,
  questionPrompt: string,
  questionType: string,
  userAnswer: string,
  modelAnswer: string | null,
  filePaths: string[]
): Promise<{ score: number; feedback: string } | null> {
  // Check cost cap before grading
  if (await isDrillCostCapped(drillId)) {
    return null;
  }

  const systemPrompt = `You are an expert interview grader. Score the candidate's answer on a scale of 0.0 to 5.0.

Question type: ${questionType}
Referenced files: ${filePaths.join(', ') || 'None'}
${modelAnswer ? `\nModel answer for comparison:\n${modelAnswer}` : ''}

Scoring criteria:
- 0-1: Completely wrong or irrelevant
- 1-2: Shows some understanding but major gaps
- 2-3: Adequate but missing key details
- 3-4: Good answer with minor gaps
- 4-5: Excellent, comprehensive answer

Respond as JSON: { "score": 3.5, "feedback": "..." }`;

  try {
    const content = await chatCompletion({
      systemPrompt,
      userMessage: `Question: ${questionPrompt}\n\nCandidate's Answer: ${userAnswer}`,
      maxTokens: 500,
      json: true,
    });
    const parsed = JSON.parse(content);
    const score = Math.max(0, Math.min(5, Number(parsed.score) || 0));
    const feedback = typeof parsed.feedback === 'string' ? parsed.feedback : 'No feedback available.';
    return { score: Math.round(score * 10) / 10, feedback };
  } catch (err) {
    console.error('gradeAnswer error:', err);
    return { score: 0, feedback: 'Grading failed — could not reach the AI model.' };
  }
}
