import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getModelConfig, TOKEN_CAPS } from '@/lib/config/models';
import { trackedOpenAICall } from '@/lib/services/cost-tracker';
import { z } from 'zod';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define the feedback schema
const FeedbackSchema = z.object({
  scores: z.object({
    clarity: z.number().min(0).max(5),
    structure: z.number().min(0).max(5),
    technical_depth: z.number().min(0).max(5),
    ownership: z.number().min(0).max(5),
    concision: z.number().min(0).max(5),
  }),
  overall: z.number().min(0).max(5),
  red_flags: z.array(z.string()),
  missing_resume_signal: z.array(z.string()),
  improved_answer: z.string(),
  followups: z.array(z.string()),
  drills: z.array(z.string()),
});

type FeedbackJSON = z.infer<typeof FeedbackSchema>;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { transcript, interviewType, question } = body;

    if (!transcript || !interviewType) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Fetch user's resume text
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { resumeText: true },
    });

    const resumeText = user?.resumeText;
    const modelConfig = getModelConfig();

    // Build the prompt
    let prompt = `You are an expert interview coach. Grade this ${interviewType} interview answer.

Question: ${question || 'General interview question'}

Candidate's Answer:
${transcript}
`;

    if (resumeText) {
      prompt += `\n\nCandidate's Resume Context:\n${resumeText.substring(0, 1000)}`;
    }

    prompt += `\n\nProvide detailed feedback in the following JSON structure:
- scores: Rate 0-5 for clarity, structure, technical_depth, ownership, concision
- overall: Overall score 0-5
- red_flags: Array of concerning statements or gaps
- missing_resume_signal: Array of resume elements not mentioned (if resume provided)
- improved_answer: A rewritten version of their answer
- followups: Array of follow-up questions an interviewer might ask
- drills: Array of specific practice recommendations`;

    const completion = await trackedOpenAICall(
      'interview-grading',
      modelConfig.analysis,
      async () => {
        return await openai.chat.completions.create({
          model: modelConfig.analysis,
          messages: [
            {
              role: 'system',
              content: 'You are an expert interview coach providing structured feedback.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'interview_feedback',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  scores: {
                    type: 'object',
                    properties: {
                      clarity: { type: 'number' },
                      structure: { type: 'number' },
                      technical_depth: { type: 'number' },
                      ownership: { type: 'number' },
                      concision: { type: 'number' },
                    },
                    required: ['clarity', 'structure', 'technical_depth', 'ownership', 'concision'],
                    additionalProperties: false,
                  },
                  overall: { type: 'number' },
                  red_flags: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  missing_resume_signal: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  improved_answer: { type: 'string' },
                  followups: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  drills: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
                required: ['scores', 'overall', 'red_flags', 'missing_resume_signal', 'improved_answer', 'followups', 'drills'],
                additionalProperties: false,
              },
            },
          },
          max_tokens: TOKEN_CAPS.grading,
        });
      },
      (result) => ({
        inputTokens: result.usage?.prompt_tokens || 0,
        outputTokens: result.usage?.completion_tokens || 0,
      })
    );

    const feedbackText = completion.choices[0].message.content;
    if (!feedbackText) {
      throw new Error('No feedback generated');
    }

    const feedback: FeedbackJSON = JSON.parse(feedbackText);

    // Save to database
    const interviewSession = await prisma.interviewSession.create({
      data: {
        company: 'General',
        difficulty: 'medium',
        interviewType,
        duration: 0,
        transcript,
        feedback,
        skillScores: feedback.scores,
        suggestions: feedback.improved_answer,
        improvementAreas: {},
        overallScore: feedback.overall,
      },
    });

    return NextResponse.json({
      sessionId: interviewSession.id,
      feedback,
    });
  } catch (error) {
    console.error('Grading error:', error);
    return NextResponse.json(
      { error: 'Failed to grade interview' },
      { status: 500 }
    );
  }
}
