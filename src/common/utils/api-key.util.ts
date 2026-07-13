import { randomBytes } from 'node:crypto';

/**
 * Prefix identifies the environment a key belongs to at a glance (in logs,
 * in a dashboard) without needing to look it up — same idea as Stripe's
 * sk_live_/sk_test_ convention.
 */
const KEY_PREFIX = {
  live: 'sk_live_',
  test: 'sk_test_',
} as const;

export type ApiKeyEnvironment = keyof typeof KEY_PREFIX;

/**
 * Generates a new API key's PLAINTEXT value. This is the only place the
 * full key ever exists as a string — the caller must hash it immediately
 * (see api-key-hash.util.ts) for storage, and return this plaintext value
 * to the client exactly once. It must never be logged or persisted as-is.
 */
export function generateApiKey(
  environment: ApiKeyEnvironment = 'live',
): string {
  // 32 random bytes -> 43 base64url characters. Cryptographically secure
  // (crypto.randomBytes), not Math.random() — this is a credential, not a
  // display ID.
  const random = randomBytes(32).toString('base64url');
  return `${KEY_PREFIX[environment]}${random}`;
}

/**
 * Builds the masked preview shown in the UI (e.g. "sk_live_••••••••7f3d"),
 * matching the frontend's ApiKey.keyPreview shape. Computed once at
 * creation from the plaintext key, stored alongside the hash — the hash
 * itself can't be reversed to reconstruct this later.
 */
export function buildApiKeyPreview(plainKey: string): string {
  const visibleStart = plainKey.slice(0, 8);
  const visibleEnd = plainKey.slice(-4);
  return `${visibleStart}${'•'.repeat(8)}${visibleEnd}`;
}
