import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversation state in memory (in production, use Redis or database)
const conversationState = new Map<string, {
  messages: Array<{ role: string; content: string }>;
  questionCount: number;
  startTime: number;
  systemPrompt: string;
}>();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sessionId, userTranscript, action } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Get interview session
    const interviewSession = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { questions: true },
    });

    if (!interviewSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Handle end interview action
    if (action === 'end') {
      const duration = Math.floor((Date.now() - new Date(interviewSession.createdAt).getTime()) / 1000);
      
      // Generate final feedback
      const feedback = await generateFinalFeedback(sessionId, interviewSession);
      
      // Update session
      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
          duration,
          overallScore: feedback.overallScore,
          skillScores: feedback.skillScores,
          suggestions: feedback.suggestions,
          improvementAreas: feedback.improvementAreas,
        },
      });

      // Clean up conversation state
      conversationState.delete(sessionId);

      return NextResponse.json({
        type: 'complete',
        sessionId,
      });
    }

    // Get or initialize conversation state
    let state = conversationState.get(sessionId);
    if (!state) {
      const systemPrompt = (interviewSession.feedback as any).systemPrompt || '';
      state = {
        messages: [
          { role: 'system', content: systemPrompt },
        ],
        questionCount: 0,
        startTime: Date.now(),
        systemPrompt,
      };
      conversationState.set(sessionId, state);
    }

    // Add user response if provided
    if (userTranscript && userTranscript.trim()) {
      state.messages.push({
        role: 'user',
        content: userTranscript,
      });

      // Get AI response
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: state.messages as any,
        max_tokens: 300,
      });

      const aiResponse = completion.choices[0].message.content || '';
      state.messages.push({
        role: 'assistant',
        content: aiResponse,
      });

      // Save question and response
      const questionText = state.messages[state.messages.length - 3]?.content || 'Follow-up question';
      
      await prisma.interviewQuestion.create({
        data: {
          sessionId,
          questionText,
          aiResponse,
          userResponse: userTranscript,
          score: 0, // Will be calculated in final feedback
          feedback: '', // Will be generated in final feedback
          timeSpent: 0,
        },
      });

      state.questionCount++;

      // Check if interview should end (after 5-7 questions)
      const shouldEnd = state.questionCount >= 5;

      return NextResponse.json({
        type: shouldEnd ? 'final_question' : 'question',
        text: aiResponse,
        questionCount: state.questionCount,
        shouldEnd,
      });
    }

    return NextResponse.json({
      type: 'waiting',
      questionCount: state.questionCount,
    });
  } catch (error) {
    console.error('Polling error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

async function generateFinalFeedback(sessionId: string, session: any) {
  const questions = await prisma.interviewQuestion.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  });

  // Build conversation summary
  const conversationSummary = questions.map((q, idx) => 
    `Q${idx + 1}: ${q.questionText}\nA${idx + 1}: ${q.userResponse}`
  ).join('\n\n');

  const prompt = `Analyze this ${session.company} interview at ${session.difficulty} difficulty level.

Interview Type: ${session.interviewType}

Conversation:
${conversationSummary}

Provide detailed feedback in JSON format:
{
  "overallScore": <number 0-5>,
  "skillScores": {
    "communication": <number 0-5>,
    "technical": <number 0-5>,
    "problemSolving": <number 0-5>,
    "clarity": <number 0-5>,
    "depth": <number 0-5>
  },
  "suggestions": "<detailed suggestions for improvement>",
  "improvementAreas": {
    "<area1>": "<specific suggestion>",
    "<area2>": "<specific suggestion>",
    "<area3>": "<specific suggestion>"
  },
  "questionFeedback": [
    {
      "questionIndex": 0,
      "score": <number 0-5>,
      "feedback": "<specific feedback for this answer>"
    }
  ]
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are an expert interview coach providing structured feedback.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500,
  });

  const feedback = JSON.parse(completion.choices[0].message.content || '{}');

  // Update individual questions with scores and feedback
  if (feedback.questionFeedback) {
    for (const qf of feedback.questionFeedback) {
      const question = questions[qf.questionIndex];
      if (question) {
        await prisma.interviewQuestion.update({
          where: { id: question.id },
          data: {
            score: qf.score,
            feedback: qf.feedback,
          },
        });
      }
    }
  }

  return feedback;
}
