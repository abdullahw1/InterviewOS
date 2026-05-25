/**
 * Question_Bank export / import (de)serialization.
 *
 * The route handlers under `src/app/api/question-bank/{import,export}` both
 * delegate to this module so the parsing and serialization paths are a
 * single source of truth and can be exercised without spinning up Next /
 * Prisma. Requirement 6.4 (round-trip property) is enforced by the
 * property test in `__tests__/serialize.test.ts`.
 *
 * Validates: Requirements 6.3, 6.4, 6.5, 20.4
 */

import { z } from 'zod';

export const QUESTION_TYPES = [
  'Code_Tracing',
  'Modification',
  'Design_Rationale',
  'Debugging',
  'Tradeoffs',
  'Scaling',
  'Security',
  'Behavioral',
] as const;

export const DIFFICULTY_TIERS = ['Easy', 'Medium', 'Hard', 'Staff'] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];

/**
 * Maximum number of entries allowed in a single import (Requirement 6.5).
 */
export const MAX_IMPORT_ENTRIES = 500;

/**
 * Canonical shape of a single Question_Bank entry as it appears in an
 * export document. The export route emits exactly these fields and the
 * import route accepts exactly these fields.
 */
export interface QuestionBankExportEntry {
  questionType: QuestionType;
  prompt: string;
  modelAnswer: string;
  rubric: string | null;
  tags: string[];
  difficultyTier: DifficultyTier;
}

/**
 * Zod schema for a single export/import entry. `rubric` defaults to null
 * and `tags` defaults to [] so callers may omit them; canonical exports
 * always include both fields explicitly.
 */
export const EntrySchema = z.object({
  questionType: z.enum(QUESTION_TYPES),
  prompt: z.string().min(1).max(5000),
  modelAnswer: z.string().min(1).max(20000),
  rubric: z.string().max(5000).nullable().optional().default(null),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  difficultyTier: z.enum(DIFFICULTY_TIERS),
});

/**
 * Zod schema for a canonical export document `{ entries: [...] }`.
 */
export const ExportSchema = z.object({
  entries: z.array(EntrySchema),
});

/**
 * Normalize a raw entry into the canonical export shape. Throws if the
 * entry fails Zod validation.
 */
export function normalizeEntry(raw: unknown): QuestionBankExportEntry {
  const parsed = EntrySchema.parse(raw);
  return {
    questionType: parsed.questionType,
    prompt: parsed.prompt,
    modelAnswer: parsed.modelAnswer,
    rubric: parsed.rubric ?? null,
    tags: [...parsed.tags],
    difficultyTier: parsed.difficultyTier,
  };
}

/**
 * Parse an export document (string or already-decoded object) into an
 * ordered list of canonical entries. Accepts either a top-level array
 * `[...]` or `{ entries: [...] }` for parity with the import route.
 */
export function parseExport(input: string | unknown): QuestionBankExportEntry[] {
  const raw = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  let list: unknown[];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (
    raw !== null &&
    typeof raw === 'object' &&
    Array.isArray((raw as { entries?: unknown }).entries)
  ) {
    list = (raw as { entries: unknown[] }).entries;
  } else {
    throw new Error('Export must be an array or { entries: [...] }');
  }
  return list.map(normalizeEntry);
}

/**
 * Serialize a list of canonical entries to the export document format.
 * Field order is fixed (questionType, prompt, modelAnswer, rubric, tags,
 * difficultyTier) so two equivalent inputs always produce byte-identical
 * JSON. Pretty-printed with 2-space indent for human readability.
 */
export function serializeForExport(entries: QuestionBankExportEntry[]): string {
  const canonical = entries.map((e) => ({
    questionType: e.questionType,
    prompt: e.prompt,
    modelAnswer: e.modelAnswer,
    rubric: e.rubric ?? null,
    tags: Array.isArray(e.tags) ? [...e.tags] : [],
    difficultyTier: e.difficultyTier,
  }));
  return JSON.stringify({ entries: canonical }, null, 2);
}
