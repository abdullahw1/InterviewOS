import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchSimilarChunks } from '@/lib/services/vector-search';
import { getModelConfig, TOKEN_CAPS } from '@/lib/config/models';
import { trackedOpenAICall } from '@/lib/services/cost-tracker';
import { z } from 'zod';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
      // Generate a quiz question
      if (!projectName) {
        return NextResponse.json(
          { error: 'Project name required' },
          { status: 400 }
        );
      }

      // Search for relevant code chunks
      const chunks = await searchSimilarChunks(
        `code implementation architecture design patterns ${projectName}`,
        projectName,
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

      const modelConfig = getModelConfig();

      const completion = await trackedOpenAICall(
        'project-quiz-generate',
        modelConfig.analysis,
        async () => {
          return await openai.chat.completions.create({
            model: modelConfig.analysis,
            messages: [
              {
                role: 'system',
                content: 'You are a technical interviewer creating questions about a codebase.',
              },
              {
                role: 'user',
                content: `Based on this code from ${projectName}, create a technical interview question.

Code Context:
${context.substring(0, 3000)}

Generate a question that tests understanding of the code architecture, design patterns, or implementation details. Include a relevant code snippet.`,
              },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'quiz_question',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    question: { type: 'string' },
                    code_snippet: { type: 'string' },
                    context: { type: 'string' },
                  },
                  required: ['question', 'code_snippet', 'context'],
                  additionalProperties: false,
                },
              },
            },
            max_tokens: TOKEN_CAPS.quiz,
          });
        },
        (result) => ({
          inputTokens: result.usage?.prompt_tokens || 0,
          outputTokens: result.usage?.completion_tokens || 0,
        })
      );

      const responseText = completion.choices[0].message.content;
      if (!responseText) {
        throw new Error('No response generated');
      }

      const questionData: QuestionJSON = JSON.parse(responseText);

      return NextResponse.json(questionData);
    } else if (action === 'grade') {
      // Grade a user's answer
      if (!userAnswer || !question || !codeSnippet) {
        return NextResponse.json(
          { error: 'Missing required fields for grading' },
          { status: 400 }
        );
      }

      // Get relevant context
      const chunks = await searchSimilarChunks(question, projectName, 3);
      const context = chunks
        .map(c => `${c.filePath}:\n${c.content}`)
        .join('\n\n');

      const modelConfig = getModelConfig();

      const completion = await trackedOpenAICall(
        'project-quiz-grade',
        modelConfig.analysis,
        async () => {
          return await openai.chat.completions.create({
            model: modelConfig.analysis,
            messages: [
              {
                role: 'system',
                content: 'You are a technical interviewer grading answers about a codebase.',
              },
              {
                role: 'user',
                content: `Question: ${question}

Code Snippet:
${codeSnippet}

Candidate's Answer:
${userAnswer}

Actual Code Context:
${context.substring(0, 2000)}

Grade the answer and provide feedback.`,
              },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'quiz_grade',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    score: { type: 'number' },
                    what_you_missed: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    strong_points: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    corrected_answer: { type: 'string' },
                    followups: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  required: ['score', 'what_you_missed', 'strong_points', 'corrected_answer', 'followups'],
                  additionalProperties: false,
                },
              },
            },
            max_tokens: TOKEN_CAPS.quiz,
          });
        },
        (result) => ({
          inputTokens: result.usage?.prompt_tokens || 0,
          outputTokens: result.usage?.completion_tokens || 0,
        })
      );

      const responseText = completion.choices[0].message.content;
      if (!responseText) {
        throw new Error('No response generated');
      }

      const gradeData: GradeJSON = JSON.parse(responseText);

      return NextResponse.json(gradeData);
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "generate" or "grade"' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Quiz error:', error);
    return NextResponse.json(
      { error: 'Failed to process quiz request' },
      { status: 500 }
    );
  }
}
