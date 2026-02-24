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

const FollowUpSchema = z.object({
  variants: z.array(
    z.object({
      subject: z.string(),
      body: z.string(),
    })
  ),
});

type FollowUpJSON = z.infer<typeof FollowUpSchema>;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { jobApplicationId } = body;

    if (!jobApplicationId) {
      return NextResponse.json(
        { error: 'Job application ID required' },
        { status: 400 }
      );
    }

    // Fetch job application details
    const application = await prisma.jobApplication.findUnique({
      where: { id: jobApplicationId },
    });

    if (!application) {
      return NextResponse.json(
        { error: 'Job application not found' },
        { status: 404 }
      );
    }

    const modelConfig = getModelConfig();

    // Generate follow-up messages
    const completion = await trackedOpenAICall(
      'job-follow-up',
      modelConfig.analysis,
      async () => {
        return await openai.chat.completions.create({
          model: modelConfig.analysis,
          messages: [
            {
              role: 'system',
              content: 'You are a professional career coach helping candidates write follow-up emails.',
            },
            {
              role: 'user',
              content: `Generate 2 follow-up email variants for this job application:

Company: ${application.company}
Role: ${application.role}
Stage: ${application.stage}
Applied Date: ${application.appliedDate.toLocaleDateString()}
${application.notes ? `Notes: ${application.notes}` : ''}

Create professional, concise follow-up emails appropriate for the current stage. Each variant should have a different tone (one more formal, one slightly more casual but still professional).`,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'follow_up_emails',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  variants: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        subject: { type: 'string' },
                        body: { type: 'string' },
                      },
                      required: ['subject', 'body'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['variants'],
                additionalProperties: false,
              },
            },
          },
          max_tokens: TOKEN_CAPS.followUp,
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

    const followUpData: FollowUpJSON = JSON.parse(responseText);

    return NextResponse.json(followUpData);
  } catch (error) {
    console.error('Follow-up generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate follow-up messages' },
      { status: 500 }
    );
  }
}
