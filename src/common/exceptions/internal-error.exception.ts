import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

/**
 * Deliberately thrown when your own code hits a state it knows is broken —
 * e.g. an invariant that should be impossible violated, a config value
 * that's required but missing at runtime. Distinct from letting an
 * unexpected error (a bug, a null pointer) bubble up to the filter's
 * catch-all: this is for cases where the code itself detected the problem
 * and is choosing to fail loudly and safely, with a clear internal message
 * for logs.
 *
 * The client only ever sees a generic message — `internalMessage` is
 * logged in full by the global filter (since status >= 500) but never sent
 * in the response, same treatment as any other 500.
 */
export class InternalErrorException extends AppException {
  constructor(internalMessage: string, details?: unknown) {
    super(
      'An unexpected error occurred. Please try again later.',
      HttpStatus.INTERNAL_SERVER_ERROR,
      {
        code: ErrorCode.INTERNAL_ERROR,
        details,
      },
    );
    // Preserve the real diagnostic message for logs without exposing it as
    // the client-facing HttpException message.
    this.cause = new Error(internalMessage);
  }
}
