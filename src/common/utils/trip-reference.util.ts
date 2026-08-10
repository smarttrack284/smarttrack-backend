import { randomBytes } from 'node:crypto';

const PREFIX = 'TRIP';

/** format (TRIP-XXXXXX), generated server-side using crypto-random bytes*/
export function generateTripReference(): string {
  const random = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `${PREFIX}-${random}`;
}
