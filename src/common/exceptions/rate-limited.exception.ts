import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

export class RateLimitedException extends AppException {
  constructor(retryAfterSeconds?: number) {
    super(
      'Too many requests. Please slow down.',
      HttpStatus.TOO_MANY_REQUESTS,
      {
        code: ErrorCode.RATE_LIMITED,
        details: retryAfterSeconds ? { retryAfterSeconds } : undefined,
      },
    );
  }
}
