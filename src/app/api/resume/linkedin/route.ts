/**
 * POST /api/resume/linkedin
 *
 * Accepts:
 *   - JSON `{ linkedinUrl, linkedinHighlights: string[] }` for the
 *     simple paste-export flow.
 *   - Or multipart with `linkedinUrl` field and a `file` (PDF or text)
 *     export from LinkedIn; parsed text is split into bullet-style
 *     highlights and persisted on `ResumeProfile.linkedinHighlights`.
 *
 * No LinkedIn scraping integration is configured (Requirement 13.3).
 *
 * Validates: Requirements 13.2, 13.3, 13.5, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  detectResumeFormat,
  extractResumeText,
  MAX_RESUME_BYTES,
  ResumeParseError,
} from '@/lib/services/resume-parsing';

const JsonBody = z.object({
  linkedinUrl: z.url().nullable().optional(),
  linkedinHighlights: z.array(z.string().min(1).max(2000)).max(200).optional(),
});

function textToHighlights(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 200);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const contentType = req.headers.get('content-type') ?? '';
    let linkedinUrl: string | null = null;
    let linkedinHighlights: string[] = [];
    let parseError: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const urlField = formData.get('linkedinUrl');
      if (typeof urlField === 'string' && urlField.trim()) linkedinUrl = urlField.trim();
      const file = formData.get('file');
      if (file && typeof file !== 'string') {
        const blob = file as File;
        if (blob.size > MAX_RESUME_BYTES) {
          return NextResponse.json(
            { error: `Upload exceeds ${MAX_RESUME_BYTES} byte limit` },
            { status: 413 }
          );
        }
        const format = detectResumeFormat(blob.name, blob.type);
        if (!format) {
          return NextResponse.json(
            { error: 'Unsupported format. Upload PDF or plain text.' },
            { status: 415 }
          );
        }
        try {
          const buf = Buffer.from(await blob.arrayBuffer());
          const text = await extractResumeText(buf, format);
          linkedinHighlights = textToHighlights(text);
        } catch (err) {
          parseError = err instanceof ResumeParseError ? err.message : 'Failed to parse export';
        }
      }
      const pasted = formData.get('pasted');
      if (typeof pasted === 'string' && pasted.trim()) {
        linkedinHighlights = textToHighlights(pasted);
      }
    } else {
      const body = await req.json().catch(() => null);
      const parsed = JsonBody.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid body', details: parsed.error.issues },
          { status: 400 }
        );
      }
      linkedinUrl = parsed.data.linkedinUrl ?? null;
      linkedinHighlights = parsed.data.linkedinHighlights ?? [];
    }

    await prisma.resumeProfile.upsert({
      where: { userId: user.id },
      update: { linkedinUrl, linkedinHighlights, parseError },
      create: {
        userId: user.id,
        linkedinUrl,
        linkedinHighlights,
        parseError,
      },
    });

    return NextResponse.json({
      ok: !parseError,
      parseError,
      linkedinUrl,
      linkedinHighlights,
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/resume/linkedin error', err);
    return NextResponse.json({ error: 'Failed to update LinkedIn profile' }, { status: 500 });
  }
}
