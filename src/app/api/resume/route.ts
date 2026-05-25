/**
 * GET / PUT / POST /api/resume
 *
 * GET  - returns `{ resumeText, linkedinUrl, linkedinHighlights, parseError }`
 *        for the authenticated user.
 * PUT  - body `{ resumeText }`. Persists raw text edits.
 * POST - multipart upload of PDF / DOCX / TXT (≤5 MB). Parsed text is
 *        stored on `ResumeProfile.resumeText`; failures persist
 *        `parseError` and surface in Settings (Requirement 13.5).
 *
 * The legacy `User.resumeText` column is kept in sync so existing
 * grading flows continue to find the resume context.
 *
 * Validates: Requirements 13.1, 13.5, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import {
  detectResumeFormat,
  extractResumeText,
  MAX_RESUME_BYTES,
  ResumeParseError,
} from '@/lib/services/resume-parsing';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const [profile, userRow] = await Promise.all([
      prisma.resumeProfile.findUnique({ where: { userId: user.id } }),
      prisma.user.findUnique({ where: { id: user.id }, select: { resumeText: true } }),
    ]);
    return NextResponse.json({
      resumeText: profile?.resumeText ?? userRow?.resumeText ?? '',
      linkedinUrl: profile?.linkedinUrl ?? null,
      linkedinHighlights: Array.isArray(profile?.linkedinHighlights)
        ? profile?.linkedinHighlights
        : [],
      parseError: profile?.parseError ?? null,
      updatedAt: profile?.updatedAt ?? null,
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('GET /api/resume error', err);
    return NextResponse.json({ error: 'Failed to fetch resume' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);
    const resumeText = typeof body?.resumeText === 'string' ? body.resumeText : '';
    await prisma.$transaction([
      prisma.resumeProfile.upsert({
        where: { userId: user.id },
        update: { resumeText, parseError: null },
        create: { userId: user.id, resumeText, parseError: null },
      }),
      prisma.user.update({ where: { id: user.id }, data: { resumeText } }),
    ]);
    return NextResponse.json({ success: true });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('PUT /api/resume error', err);
    return NextResponse.json({ error: 'Failed to update resume' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const formData = await req.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
    }
    const blob = file as File;
    if (blob.size > MAX_RESUME_BYTES) {
      return NextResponse.json(
        { error: `Resume exceeds ${MAX_RESUME_BYTES} byte limit` },
        { status: 413 }
      );
    }
    const format = detectResumeFormat(blob.name, blob.type);
    if (!format) {
      return NextResponse.json(
        { error: 'Unsupported format. Upload PDF, DOCX, or plain text.' },
        { status: 415 }
      );
    }

    const buf = Buffer.from(await blob.arrayBuffer());
    let resumeText = '';
    let parseError: string | null = null;
    try {
      resumeText = (await extractResumeText(buf, format)).trim();
      if (!resumeText) parseError = 'Parsed resume was empty';
    } catch (err) {
      parseError = err instanceof ResumeParseError ? err.message : 'Failed to parse resume';
    }

    await prisma.$transaction([
      prisma.resumeProfile.upsert({
        where: { userId: user.id },
        update: { resumeText: parseError ? null : resumeText, parseError },
        create: {
          userId: user.id,
          resumeText: parseError ? null : resumeText,
          parseError,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { resumeText: parseError ? null : resumeText },
      }),
    ]);

    return NextResponse.json({
      ok: !parseError,
      parseError,
      resumeText: parseError ? null : resumeText,
    });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/resume error', err);
    return NextResponse.json({ error: 'Failed to upload resume' }, { status: 500 });
  }
}
