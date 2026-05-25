/**
 * Resume / LinkedIn parsing helpers.
 *
 * Extracts plain text from PDF, DOCX, or text uploads up to 5 MB. PDF
 * parsing uses `pdf-parse`; DOCX uses `mammoth`. Plain text is taken as
 * UTF-8.
 *
 * Validates: Requirements 13.1 - 13.5
 */

import { Buffer } from 'node:buffer';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export type ResumeMime =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/msword'
  | 'text/plain';

export class ResumeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeParseError';
  }
}

export function detectResumeFormat(filename: string, contentType?: string | null): ResumeMime | null {
  const lower = filename.toLowerCase();
  const ct = (contentType ?? '').toLowerCase().split(';')[0].trim();
  if (lower.endsWith('.pdf') || ct === 'application/pdf') return 'application/pdf';
  if (
    lower.endsWith('.docx') ||
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.doc') || ct === 'application/msword') return 'application/msword';
  if (lower.endsWith('.txt') || ct === 'text/plain') return 'text/plain';
  return null;
}

export async function extractResumeText(file: Buffer, format: ResumeMime): Promise<string> {
  if (file.byteLength > MAX_RESUME_BYTES) {
    throw new ResumeParseError('Resume exceeds 5 MB limit');
  }
  if (format === 'text/plain') {
    return file.toString('utf-8');
  }
  if (format === 'application/pdf') {
    try {
      // pdf-parse v2 exports a PDFParse class. Turbopack rewrites module
      // paths so the auto-detected worker URL fails — point pdf-parse at
      // the real worker file in node_modules.
      const { PDFParse } = await import('pdf-parse');
      const path = await import('node:path');
      const workerPath = path.join(
        process.cwd(),
        'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
      );
      try {
        (PDFParse as unknown as { setWorker: (p: string) => void }).setWorker(workerPath);
      } catch {
        // setWorker may not exist on older versions; ignore
      }
      const parser = new PDFParse({ data: file, verbosity: 0 });
      const result = await parser.getText();
      await parser.destroy?.();
      return result.text ?? '';
    } catch (err) {
      if (err instanceof ResumeParseError) throw err;
      throw new ResumeParseError(
        `PDF parse failed: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
  }
  if (
    format === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    format === 'application/msword'
  ) {
    try {
      const mod = (await import('mammoth')) as {
        extractRawText?: (input: { buffer: Buffer }) => Promise<{ value: string }>;
      };
      if (!mod.extractRawText) {
        throw new ResumeParseError('mammoth extractRawText unavailable');
      }
      const result = await mod.extractRawText({ buffer: file });
      return result.value ?? '';
    } catch (err) {
      throw new ResumeParseError(
        `DOCX parse failed: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
  }
  throw new ResumeParseError('Unsupported format');
}
