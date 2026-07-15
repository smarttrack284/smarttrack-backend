import { randomBytes } from 'node:crypto';

const PREFIX = 'ORD';

/** format (ORD-XXXXXX), generated server-side using crypto-random bytes */
export function generateOrderReference(): string {
  const random = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `${PREFIX}-${random}`;
}
