import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TOKEN_CAPS } from '@/lib/config/models';
import { chatWithClaude } from '@/lib/claude';
import { z } from 'zod';

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
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, resumeText: true },
    });

    const resumeText = user?.resumeText;

    let userMessage = `You are an expert interview coach. Grade this ${interviewType} interview answer.

Question: ${question || 'General interview question'}

Candidate's Answer:
${transcript}
`;

    if (resumeText) {
      userMessage += `\n\nCandidate's Resume Context:\n${resumeText.substring(0, 1000)}`;
    }

    userMessage += `\n\nProvide feedback as JSON:
{
  "scores": { "clarity": 0-5, "structure": 0-5, "technical_depth": 0-5, "ownership": 0-5, "concision": 0-5 },
  "overall": 0-5,
  "red_flags": ["..."],
  "missing_resume_signal": ["..."],
  "improved_answer": "...",
  "followups": ["..."],
  "drills": ["..."]
}`;

    const feedbackText = await chatWithClaude({
      feature: 'interview-grading',
      systemPrompt: 'You are an expert interview coach providing structured feedback. Respond with valid JSON only.',
      userMessage,
      maxTokens: TOKEN_CAPS.grading,
      json: true,
    });

    const feedback: FeedbackJSON = JSON.parse(feedbackText);

    const interviewSession = await prisma.interviewSession.create({
      data: {
        user: { connect: { id: user!.id } },
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

    return NextResponse.json({ sessionId: interviewSession.id, feedback });
  } catch (error) {
    console.error('Grading error:', error);
    return NextResponse.json({ error: 'Failed to grade interview' }, { status: 500 });
  }
}
