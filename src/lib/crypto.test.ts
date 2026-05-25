/**
 * Unit tests for `src/lib/crypto.ts`.
 *
 * Covers:
 *   - Round-trip property: decrypt(encrypt(x)) === x for arbitrary inputs.
 *   - Tamper detection: any modification to the ciphertext fails decryption.
 *   - Key derivation from `GITHUB_TOKEN_ENC_KEY`: missing, malformed,
 *     wrong length, and valid cases.
 *   - The wire format prefix (12-byte IV + 16-byte tag).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import fc from 'fast-check';

import {
  decryptAesGcm,
  encryptAesGcm,
  getGithubTokenEncKey,
  decryptGithubToken,
  encryptGithubToken,
} from './crypto';

function makeKey(): Buffer {
  return crypto.randomBytes(32);
}

describe('encryptAesGcm / decryptAesGcm', () => {
  it('round-trips simple ASCII text', () => {
    const key = makeKey();
    const ciphertext = encryptAesGcm('hello world', key);
    expect(decryptAesGcm(ciphertext, key)).toBe('hello world');
  });

  it('round-trips arbitrary unicode strings (property)', () => {
    const key = makeKey();
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 1024 }), (plaintext) => {
        const ct = encryptAesGcm(plaintext, key);
        return decryptAesGcm(ct, key) === plaintext;
      }),
      { numRuns: 50 }
    );
  });

  it('produces distinct ciphertexts for the same plaintext (random IV)', () => {
    const key = makeKey();
    const a = encryptAesGcm('same plaintext', key);
    const b = encryptAesGcm('same plaintext', key);
    expect(a.equals(b)).toBe(false);
  });

  it('packs IV (12B) + tag (16B) + ciphertext as a Buffer', () => {
    const key = makeKey();
    const ct = encryptAesGcm('abc', key);
    // 12 IV + 16 tag + 3 plaintext bytes (GCM has no padding)
    expect(ct.length).toBe(12 + 16 + 3);
  });

  it('throws when the auth tag is tampered with', () => {
    const key = makeKey();
    const ct = encryptAesGcm('top secret', key);
    // Flip a bit in the tag region (bytes 12..28)
    ct[15] ^= 0x01;
    expect(() => decryptAesGcm(ct, key)).toThrow();
  });

  it('throws when the ciphertext body is tampered with', () => {
    const key = makeKey();
    const ct = encryptAesGcm('top secret', key);
    ct[ct.length - 1] ^= 0x01;
    expect(() => decryptAesGcm(ct, key)).toThrow();
  });

  it('throws when the key length is wrong', () => {
    expect(() => encryptAesGcm('x', crypto.randomBytes(16))).toThrow(/32 bytes/);
    expect(() => decryptAesGcm(Buffer.alloc(32), crypto.randomBytes(16))).toThrow(/32 bytes/);
  });

  it('throws when the payload is too short to contain IV + tag', () => {
    const key = makeKey();
    expect(() => decryptAesGcm(Buffer.alloc(10), key)).toThrow(/too short/);
  });
});

describe('getGithubTokenEncKey', () => {
  const original = process.env.GITHUB_TOKEN_ENC_KEY;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN_ENC_KEY;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GITHUB_TOKEN_ENC_KEY;
    } else {
      process.env.GITHUB_TOKEN_ENC_KEY = original;
    }
  });

  it('throws a clear error when the env var is missing', () => {
    expect(() => getGithubTokenEncKey()).toThrow(/GITHUB_TOKEN_ENC_KEY is not set/);
  });

  it('throws when decoded length is not 32 bytes', () => {
    process.env.GITHUB_TOKEN_ENC_KEY = Buffer.from('too short').toString('base64');
    expect(() => getGithubTokenEncKey()).toThrow(/32 bytes/);
  });

  it('returns a 32-byte buffer for a valid base64 key', () => {
    process.env.GITHUB_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
    const key = getGithubTokenEncKey();
    expect(key.length).toBe(32);
  });

  it('encryptGithubToken/decryptGithubToken round-trips with env key', () => {
    process.env.GITHUB_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
    const token = 'ghp_' + 'x'.repeat(36);
    const ct = encryptGithubToken(token);
    expect(decryptGithubToken(ct)).toBe(token);
  });
});
