/**
 * Stable, machine-readable error codes — separate from the human-readable
 * `message`. Clients (like the frontend's Supabase auth error mapping) can
 * branch on `code` reliably; `message` wording can change without breaking
 * that logic.
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  BAD_GATEWAY = 'BAD_GATEWAY',
  TIMEOUT = 'TIMEOUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
