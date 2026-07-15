import { randomBytes } from 'node:crypto';

const PREFIX = 'STK';

/** format (STK-XXXXXX), generated server-side using crypto-random bytes*/
export function generateTrackingNumber(): string {
  const random = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `${PREFIX}-${random}`;
}
