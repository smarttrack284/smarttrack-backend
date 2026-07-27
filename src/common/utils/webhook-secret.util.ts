import { createCipheriv, createDecipheriv, createHmac, randomBytes, } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

export function generateWebhookSecret(): string {
  return `ST_whsec_${randomBytes(24).toString('base64url')}`;
}

/**
 * Reversible encryption, deliberately NOT one-way hashing — a webhook
 * secret must be retrievable in plaintext at delivery time to compute
 * each signature, unlike an API key which only ever needs a
 * present-vs-stored comparison. WEBHOOK_ENCRYPTION_KEY must be a 32-byte
 * key, base64-encoded in the environment — generate with
 * `openssl rand -base64 32`. Losing/rotating this key invalidates every
 * stored secret at once; treat it like a master key, not a casual config value.
 */
export function encryptWebhookSecret(plainSecret: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainSecret, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptWebhookSecret(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivB64, authTagB64, dataB64] = encrypted.split(':');
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function getEncryptionKey(): Buffer {
  const keyB64 = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (!keyB64) throw new Error('WEBHOOK_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32)
    throw new Error('WEBHOOK_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

/**
 * Stripe-style signature scheme: signed string is "{timestamp}.{rawBody}",
 * not the payload alone — including the timestamp lets a receiver reject
 * old/replayed deliveries (check |now - timestamp| < some tolerance)
 * rather than only verifying the payload wasn't tampered with.
 */
export function computeWebhookSignature(
  secret: string,
  timestamp: number,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}
