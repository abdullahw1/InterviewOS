/**
 * AES-256-GCM helpers for at-rest secret encryption.
 *
 * Used by `ingest/github.ts` to encrypt the user's GitHub access token
 * before persisting it on `GitHubConnection.encryptedAccessToken`. The
 * key is supplied via the `GITHUB_TOKEN_ENC_KEY` environment variable as
 * a base64-encoded 32-byte buffer.
 *
 * Wire format (Buffer): [12-byte IV][16-byte auth tag][ciphertext...]
 *
 * Rationale:
 *   - GCM provides authenticated encryption so any tampering is rejected
 *     on decryption.
 *   - 12-byte IV is the GCM-recommended length and is generated per call
 *     with `randomBytes`. We never reuse an IV under the same key.
 *   - Concatenating IV + tag + ciphertext into a single Buffer keeps the
 *     storage shape simple (one `Bytes` column) and avoids JSON wrapping.
 *
 * See `.kiro/specs/project-interview-drills/design.md` (Security section).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Resolve the AES-256-GCM key from `GITHUB_TOKEN_ENC_KEY`.
 *
 * The env var must be base64-encoded and decode to exactly 32 bytes.
 * Misconfiguration throws an Error with a clear, action-oriented message
 * so the developer can fix `.env` quickly. The error message intentionally
 * does not echo the value of the env var.
 */
export function getGithubTokenEncKey(): Buffer {
  const raw = process.env.GITHUB_TOKEN_ENC_KEY;
  if (!raw || raw.trim() === '') {
    throw new Error(
      'GITHUB_TOKEN_ENC_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env'
    );
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    throw new Error(
      'GITHUB_TOKEN_ENC_KEY is not valid base64. Generate one with `openssl rand -base64 32`'
    );
  }

  if (decoded.length !== KEY_LENGTH) {
    throw new Error(
      `GITHUB_TOKEN_ENC_KEY must decode to ${KEY_LENGTH} bytes (got ${decoded.length}). ` +
        'Generate one with `openssl rand -base64 32`'
    );
  }

  return decoded;
}

/**
 * Encrypt `plaintext` (UTF-8 string) with AES-256-GCM using `key`.
 *
 * Returns a Buffer that packs the per-call IV, the GCM auth tag, and the
 * ciphertext. Decryption is the inverse via `decryptAesGcm`.
 */
export function encryptAesGcm(plaintext: string, key: Buffer): Buffer {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AES-256-GCM key must be ${KEY_LENGTH} bytes`);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypt a buffer produced by `encryptAesGcm`. Throws on tampering or a
 * malformed payload.
 */
export function decryptAesGcm(payload: Uint8Array, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AES-256-GCM key must be ${KEY_LENGTH} bytes`);
  }
  if (payload.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Encrypted payload is too short to be valid AES-256-GCM output');
  }
  const buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Convenience wrappers using the env-resolved key.
 */
export function encryptGithubToken(token: string): Buffer {
  return encryptAesGcm(token, getGithubTokenEncKey());
}

export function decryptGithubToken(payload: Uint8Array): string {
  return decryptAesGcm(payload, getGithubTokenEncKey());
}
