/**
 * Vapi webhook signature verification.
 *
 * `verifyVapiSignature` recomputes the HMAC-SHA256 of the raw request body
 * using `secret` and compares it to the supplied signature header in
 * constant time via `crypto.timingSafeEqual`. Any input mismatch (length,
 * encoding, missing header) returns `false` — never throws.
 *
 * Validates: Requirements 9.9, 9.10, 20.7
 */

import crypto from 'crypto';

/**
 * Verify a Vapi webhook signature.
 *
 * @param rawBody The exact request body bytes received (string-encoded by
 *   Next's `req.text()`).
 * @param signatureHeader The `x-vapi-signature` header value, or `null`
 *   when the header is absent.
 * @param secret The shared secret (`VAPI_WEBHOOK_SECRET`).
 * @returns `true` only when the header is a valid hex HMAC-SHA256 of
 *   `rawBody` under `secret`. Returns `false` for any malformed input.
 */
export function verifyVapiSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!secret || !signatureHeader) return false;

  const provided = signatureHeader.trim().toLowerCase();
  if (provided.length === 0) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (provided.length !== expected.length) return false;

  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(provided, 'hex');
    expectedBuf = Buffer.from(expected, 'hex');
  } catch {
    return false;
  }

  if (providedBuf.length !== expectedBuf.length) return false;

  try {
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}
