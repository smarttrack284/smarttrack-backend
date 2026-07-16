import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInviteToken(plainToken: string): string {
  const secret = process.env.INVITE_TOKEN_SECRET;
  if (!secret) {
    throw new Error('INVITE_TOKEN_SECRET is not configured');
  }
  return createHmac('sha256', secret).update(plainToken).digest('hex');
}

export function verifyInviteToken(
  plainToken: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashInviteToken(plainToken), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function getInviteTokenExpiry(): Date {
  return new Date(Date.now() + INVITE_TOKEN_TTL_MS);
}
