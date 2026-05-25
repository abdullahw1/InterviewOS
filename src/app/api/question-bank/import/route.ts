/**
 * POST /api/question-bank/import
 *
 * Bulk import Question_Bank entries from JSON or CSV. Caps each upload
 * at 500 entries (Requirement 6.5). Skips rows that fail validation
 * and surfaces them to the caller so they can fix and resubmit.
 *
 * Validates: Requirements 6.3, 6.5, 20.6
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { httpErrorResponse, requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';

const QUESTION_TYPES = [
  'Code_Tracing',
  'Modification',
  'Design_Rationale',
  'Debugging',
  'Tradeoffs',
  'Scaling',
  'Security',
  'Behavioral',
] as const;
const DIFFICULTY_TIERS = ['Easy', 'Medium', 'Hard', 'Staff'] as const;

const MAX_ENTRIES = 500;

const EntrySchema = z.object({
  questionType: z.enum(QUESTION_TYPES),
  prompt: z.string().min(1).max(5000),
  modelAnswer: z.string().min(1).max(20000),
  rubric: z.string().max(5000).nullable().optional().default(null),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  difficultyTier: z.enum(DIFFICULTY_TIERS),
});

/** Minimal RFC 4180-ish CSV parser supporting quoted fields with escaped quotes. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // skip; \n will close the row
    } else {
      field += ch;
    }
  }
  // Flush last cell / row.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.length > 0));
}

function csvToEntries(text: string): unknown[] {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const required = ['questionType', 'prompt', 'modelAnswer', 'difficultyTier'];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new Error(`CSV missing required column: ${col}`);
    }
  }
  const idx = (name: string) => header.indexOf(name);
  return rows.slice(1).map((r) => ({
    questionType: r[idx('questionType')]?.trim(),
    prompt: r[idx('prompt')] ?? '',
    modelAnswer: r[idx('modelAnswer')] ?? '',
    rubric:
      idx('rubric') >= 0 && r[idx('rubric')]?.length ? r[idx('rubric')] : null,
    tags:
      idx('tags') >= 0 && r[idx('tags')]?.length
        ? r[idx('tags')]
            .split(/[|;]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    difficultyTier: r[idx('difficultyTier')]?.trim(),
  }));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const contentType = req.headers.get('content-type') ?? '';

    let rawEntries: unknown[];
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => null);
      const list = Array.isArray(body) ? body : Array.isArray(body?.entries) ? body.entries : null;
      if (!list) {
        return NextResponse.json(
          { error: 'JSON body must be an array or { entries: [...] }' },
          { status: 400 }
        );
      }
      rawEntries = list;
    } else {
      // CSV / text/csv / multipart text bodies all fall through here.
      const text = await req.text();
      try {
        rawEntries = csvToEntries(text);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Failed to parse CSV' },
          { status: 400 }
        );
      }
    }

    if (rawEntries.length > MAX_ENTRIES) {
      return NextResponse.json(
        {
          error: `Import exceeds the per-upload limit of ${MAX_ENTRIES} entries (got ${rawEntries.length})`,
        },
        { status: 400 }
      );
    }

    const accepted: z.infer<typeof EntrySchema>[] = [];
    const rejected: Array<{ index: number; error: string }> = [];
    rawEntries.forEach((raw, i) => {
      const parsed = EntrySchema.safeParse(raw);
      if (parsed.success) {
        accepted.push(parsed.data);
      } else {
        rejected.push({ index: i, error: parsed.error.issues.map((iss) => iss.message).join('; ') });
      }
    });

    let inserted = 0;
    if (accepted.length > 0) {
      const result = await prisma.questionBankEntry.createMany({
        data: accepted.map((e) => ({
          userId: user.id,
          questionType: e.questionType,
          prompt: e.prompt,
          modelAnswer: e.modelAnswer,
          rubric: e.rubric ?? null,
          tags: e.tags,
          difficultyTier: e.difficultyTier,
        })),
      });
      inserted = result.count;
    }

    return NextResponse.json({ inserted, rejected });
  } catch (err) {
    const httpResponse = httpErrorResponse(err);
    if (httpResponse) return httpResponse;
    console.error('POST /api/question-bank/import error', err);
    return NextResponse.json({ error: 'Failed to import entries' }, { status: 500 });
  }
}
