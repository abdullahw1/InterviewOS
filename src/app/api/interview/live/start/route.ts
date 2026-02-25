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

const COMPANY_CONTEXTS: Record<string, string> = {
  google: 'Google values innovation, technical excellence, and data-driven decision making. Focus on scalability, user impact, and collaborative problem-solving.',
  amazon: 'Amazon emphasizes customer obsession, ownership, and delivering results. Use the STAR method and demonstrate leadership principles.',
  meta: 'Meta (Facebook) looks for impact, moving fast, and being bold. Show how you build products that connect people and scale globally.',
  microsoft: 'Microsoft values growth mindset, customer focus, and inclusive collaboration. Demonstrate technical depth and business acumen.',
  apple: 'Apple prioritizes innovation, attention to detail, and user experience. Show passion for creating exceptional products.',
  netflix: 'Netflix values freedom and responsibility, context over control, and high performance. Demonstrate independent decision-making.',
  default: 'This company values technical excellence, problem-solving ability, and cultural fit. Be specific, use examples, and show impact.',
};

const DIFFICULTY_PROMPTS = {
  easy: 'Ask entry-level questions focusing on fundamentals, basic scenarios, and learning ability.',
  medium: 'Ask mid-level questions requiring practical experience, trade-off analysis, and deeper technical knowledge.',
  hard: 'Ask senior-level questions involving complex systems, leadership scenarios, architectural decisions, and strategic thinking.',
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    console.log('Session check:', { 
      hasSession: !!session, 
      email: session?.user?.email 
    });
    
    if (!session?.user?.email) {
      console.error('No session found - user not authenticated');
      return NextResponse.json({ error: 'Unauthorized - Please log in' }, { status: 401 });
    }

    const { company, difficulty, interviewType } = await request.json();

    if (!company || !difficulty || !interviewType) {
      console.error('Missing required fields:', { company, difficulty, interviewType });
      return NextResponse.json(
        { error: 'Missing required fields: company, difficulty, or interviewType' },
        { status: 400 }
      );
    }

    // Get user's resume and project context
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { resumeText: true },
    });

    // Get project summaries for context
    const projects = await prisma.projectSummary.findMany({
      take: 5,
    });

    const companyKey = company.toLowerCase().replace(/\s+/g, '');
    const companyContext = COMPANY_CONTEXTS[companyKey] || COMPANY_CONTEXTS.default;
    const difficultyPrompt = DIFFICULTY_PROMPTS[difficulty as keyof typeof DIFFICULTY_PROMPTS];

    // Generate first question
    const systemPrompt = `You are an experienced interviewer from ${company}. ${companyContext}

${difficultyPrompt}

Interview Type: ${interviewType}

Candidate's Background:
${user?.resumeText ? user.resumeText.substring(0, 1000) : 'No resume provided'}

${projects.length > 0 ? `Candidate's Projects:\n${projects.map(p => `- ${p.repoName}: ${p.description}`).join('\n')}` : ''}

Conduct a professional interview. Ask one question at a time. Listen to their response, provide brief follow-ups if needed, and move to the next question. Keep questions realistic and relevant to ${company}'s interview style.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Start the interview with a greeting and the first question.' },
      ],
      max_tokens: 300,
    });

    const firstQuestion = completion.choices[0].message.content || 'Tell me about yourself and why you want to work at ' + company;

    // Create interview session
    const interviewSession = await prisma.interviewSession.create({
      data: {
        company,
        difficulty,
        interviewType,
        duration: 0,
        transcript: '',
        overallScore: 0,
        skillScores: {},
        feedback: { systemPrompt },
        suggestions: '',
        improvementAreas: {},
      },
    });

    return NextResponse.json({
      sessionId: interviewSession.id,
      firstQuestion,
    });
  } catch (error) {
    console.error('Error starting interview:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to start interview: ' + errorMessage },
      { status: 500 }
    );
  }
}
