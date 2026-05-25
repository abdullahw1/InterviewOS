import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { verifyVapiSignature } from './webhook-verify';

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyVapiSignature', () => {
  it('accepts a valid signature for any body+secret pair', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 2000 }),
        fc.string({ minLength: 1, maxLength: 128 }),
        (body, secret) => {
          const sig = sign(body, secret);
          expect(verifyVapiSignature(body, sig, secret)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a tampered body (one character flipped)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 2000 }),
        fc.string({ minLength: 1, maxLength: 128 }),
        fc.integer({ min: 0, max: 254 }),
        (body, secret, flip) => {
          const sig = sign(body, secret);
          // Flip the first byte of the body to a different character
          const tampered = String.fromCharCode(flip === body.charCodeAt(0) ? flip + 1 : flip) + body.slice(1);
          expect(verifyVapiSignature(tampered, sig, secret)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a forged signature (random hex string of correct length)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 2000 }),
        fc.string({ minLength: 1, maxLength: 128 }),
        fc.stringMatching(/^[0-9a-f]{64}$/),
        (body, secret, forgedSig) => {
          const realSig = sign(body, secret);
          // Only assert when the forged sig happens to differ from the real one
          fc.pre(forgedSig !== realSig);
          expect(verifyVapiSignature(body, forgedSig, secret)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a null signature header', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string({ minLength: 1 }),
        (body, secret) => {
          expect(verifyVapiSignature(body, null, secret)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects an empty secret', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (body, sig) => {
          expect(verifyVapiSignature(body, sig, '')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects a signature computed with a different secret', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 2000 }),
        fc.string({ minLength: 1, maxLength: 128 }),
        fc.string({ minLength: 1, maxLength: 128 }),
        (body, secret, wrongSecret) => {
          fc.pre(secret !== wrongSecret);
          const sig = sign(body, wrongSecret);
          expect(verifyVapiSignature(body, sig, secret)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
