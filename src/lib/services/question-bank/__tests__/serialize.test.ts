/**
 * Round-trip property test for Question_Bank export / import.
 *
 * For arbitrary valid Question Bank exports E, parsing E and then
 * re-serializing must produce a JSON document equal to E under
 * field-by-field comparison.
 *
 * Validates: Requirements 6.4, 20.4
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DIFFICULTY_TIERS,
  QUESTION_TYPES,
  type QuestionBankExportEntry,
  parseExport,
  serializeForExport,
} from '../serialize';

/**
 * Smart generator constraining to the canonical export entry shape. Each
 * generated entry satisfies the Zod schema in `serialize.ts` (non-empty
 * prompt/modelAnswer, ≤20 tags, etc.), so every export this produces is
 * a valid Question_Bank export.
 */
const entryArb: fc.Arbitrary<QuestionBankExportEntry> = fc.record({
  questionType: fc.constantFrom(...QUESTION_TYPES),
  // Bound prompt / modelAnswer well below schema limits so the generator
  // stays fast while still exercising unicode.
  prompt: fc.string({ minLength: 1, maxLength: 200 }),
  modelAnswer: fc.string({ minLength: 1, maxLength: 400 }),
  // rubric is nullable; mix nulls and short strings.
  rubric: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
  // Tags: 0–10 short non-empty strings.
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
    minLength: 0,
    maxLength: 10,
  }),
  difficultyTier: fc.constantFrom(...DIFFICULTY_TIERS),
});

const exportDocArb = fc.array(entryArb, { minLength: 0, maxLength: 30 }).map(
  (entries) => ({ entries })
);

describe('Question_Bank export round-trip', () => {
  it('parseExport(serializeForExport(E)) deepEquals E for arbitrary valid exports', () => {
    fc.assert(
      fc.property(exportDocArb, (E) => {
        const serialized = serializeForExport(E.entries);
        const reparsed = parseExport(serialized);
        // The canonical export document is `{ entries: [...] }`.
        // Re-serializing the reparsed entries must produce the same JSON
        // document as serializing the original entries.
        const reSerialized = serializeForExport(reparsed);
        expect(reSerialized).toBe(serialized);
        // And the parsed entries must be field-for-field equal to E.entries.
        expect(reparsed).toEqual(E.entries);
      }),
      { numRuns: 200 }
    );
  });

  it('parseExport accepts the canonical { entries: [...] } envelope', () => {
    fc.assert(
      fc.property(exportDocArb, (E) => {
        const json = JSON.stringify(E);
        expect(parseExport(json)).toEqual(E.entries);
      }),
      { numRuns: 100 }
    );
  });
});
