import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchSimilarChunks } from '@/lib/services/vector-search';
import { TOKEN_CAPS } from '@/lib/config/models';
import { chatWithClaude } from '@/lib/claude';
import { z } from 'zod';

const QuestionSchema = z.object({
  question: z.string(),
  code_snippet: z.string(),
  context: z.string(),
});

const GradeSchema = z.object({
  score: z.number().min(0).max(5),
  what_you_missed: z.array(z.string()),
  strong_points: z.array(z.string()),
  corrected_answer: z.string(),
  followups: z.array(z.string()),
});

type QuestionJSON = z.infer<typeof QuestionSchema>;
type GradeJSON = z.infer<typeof GradeSchema>;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, projectName, userAnswer, question, codeSnippet } = body;

    if (action === 'generate') {
      if (!projectName) {
        return NextResponse.json({ error: 'Project name required' }, { status: 400 });
      }

      const chunks = await searchSimilarChunks(
        `code implementation architecture design patterns ${projectName}`,
        [projectName],
        5
      );

      if (chunks.length === 0) {
        return NextResponse.json(
          { error: 'No indexed code found for this project' },
          { status: 404 }
        );
      }

      const context = chunks
        .map(c => `File: ${c.filePath}\n\n${c.content}`)
        .join('\n\n---\n\n');

      const responseText = await chatWithClaude({
        feature: 'project-quiz-generate',
        systemPrompt: 'You are a technical interviewer creating questions about a codebase. Respond with valid JSON only.',
        userMessage: `Based on this code from ${projectName}, create a technical interview question.

Code Context:
${context.substring(0, 3000)}

Generate a question that tests understanding of the code architecture, design patterns, or implementation details. Include a relevant code snippet.

Respond as JSON: { "question": "...", "code_snippet": "...", "context": "..." }`,
        maxTokens: TOKEN_CAPS.quiz,
        json: true,
      });

      const questionData: QuestionJSON = JSON.parse(responseText);
      return NextResponse.json(questionData);

    } else if (action === 'grade') {
      if (!userAnswer || !question || !codeSnippet) {
        return NextResponse.json(
          { error: 'Missing required fields for grading' },
          { status: 400 }
        );
      }

      const chunks = await searchSimilarChunks(question, projectName ? [projectName] : undefined, 3);
      const context = chunks
        .map(c => `${c.filePath}:\n${c.content}`)
        .join('\n\n');

      const responseText = await chatWithClaude({
        feature: 'project-quiz-grade',
        systemPrompt: 'You are a technical interviewer grading answers about a codebase. Respond with valid JSON only.',
        userMessage: `Question: ${question}

Code Snippet:
${codeSnippet}

Candidate's Answer:
${userAnswer}

Actual Code Context:
${context.substring(0, 2000)}

Grade the answer and provide feedback.
Respond as JSON: { "score": 0-5, "what_you_missed": [...], "strong_points": [...], "corrected_answer": "...", "followups": [...] }`,
        maxTokens: TOKEN_CAPS.quiz,
        json: true,
      });

      const gradeData: GradeJSON = JSON.parse(responseText);
      return NextResponse.json(gradeData);

    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Quiz error:', error);
    return NextResponse.json({ error: 'Failed to process quiz request' }, { status: 500 });
  }
}
