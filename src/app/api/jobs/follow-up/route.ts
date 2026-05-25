import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TOKEN_CAPS } from '@/lib/config/models';
import { chatWithClaude } from '@/lib/claude';
import { z } from 'zod';

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
      return NextResponse.json({ error: 'Job application ID required' }, { status: 400 });
    }

    const application = await prisma.jobApplication.findUnique({
      where: { id: jobApplicationId },
    });

    if (!application) {
      return NextResponse.json({ error: 'Job application not found' }, { status: 404 });
    }

    const responseText = await chatWithClaude({
      feature: 'job-follow-up',
      systemPrompt: 'You are a professional career coach helping candidates write follow-up emails. Respond with valid JSON only.',
      userMessage: `Generate 2 follow-up email variants for this job application:

Company: ${application.company}
Role: ${application.role}
Stage: ${application.stage}
Applied Date: ${application.appliedDate.toLocaleDateString()}
${application.notes ? `Notes: ${application.notes}` : ''}

Create professional, concise follow-up emails appropriate for the current stage. One more formal, one slightly more casual but still professional.

Respond as JSON: { "variants": [{ "subject": "...", "body": "..." }, { "subject": "...", "body": "..." }] }`,
      maxTokens: TOKEN_CAPS.followUp,
      json: true,
    });

    const followUpData: FollowUpJSON = JSON.parse(responseText);
    return NextResponse.json(followUpData);
  } catch (error) {
    console.error('Follow-up generation error:', error);
    return NextResponse.json({ error: 'Failed to generate follow-up messages' }, { status: 500 });
  }
}
