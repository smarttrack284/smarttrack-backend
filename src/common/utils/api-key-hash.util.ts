import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Hashes a plaintext API key for storage/lookup. Uses HMAC-SHA256 with a
 * server-side secret (rather than plain SHA-256) so that even if the
 * database's key_hash column leaked on its own, it can't be brute-forced
 * offline without also having API_KEY_HASH_SECRET — same reasoning as
 * salting a password hash, but simpler since API keys are already
 * high-entropy random strings, not user-chosen passwords needing bcrypt's
 * slow, per-hash-salt design.
 *
 * never-reused value distinct from any other app secret. Rotating it
 * invalidates every existing API key, so treat it like a signing key, not
 * a config value that gets casually changed.
 */
export function hashApiKey(plainKey: string): string {
  const secret = process.env.API_KEY_HASH_SECRET;
  if (!secret) {
    throw new Error('API_KEY_HASH_SECRET is not configured');
  }
  return createHmac('sha256', secret).update(plainKey).digest('hex');
}

/**
 * Verifies a presented key against a stored hash using a constant-time
 * comparison (timingSafeEqual), not `===`. A naive string comparison
 * returns as soon as the first differing character is found, which leaks
 * timing information an attacker could use to guess a valid hash
 * byte-by-byte — constant-time comparison takes the same time regardless
 * of where (or whether) the strings differ.
 */
export function verifyApiKey(plainKey: string, storedHash: string): boolean {
  const candidateHash = hashApiKey(plainKey);

  const candidateBuffer = Buffer.from(candidateHash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');

  // Buffers of different lengths would throw in timingSafeEqual — since
  // both are fixed-length SHA-256 hex digests this should never happen in
  // practice, but guard explicitly rather than letting it throw.
  if (candidateBuffer.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(candidateBuffer, storedBuffer);
}

/** Convenience re-export so callers doing a one-off integrity check don't need the HMAC-vs-plain distinction spelled out — kept internal to this module otherwise. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
