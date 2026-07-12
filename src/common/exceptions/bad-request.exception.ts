import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

/**
 * A general-purpose "the request can't be processed as sent" error, for
 * cases that don't fit ValidationException (field-level) or
 * UnprocessableEntityException (well-formed but violates a business rule).
 * Use this for malformed request shapes, unsupported combinations of
 * otherwise-valid params, etc. — the catch-all 400, kept explicit rather
 * than reaching for Nest's built-in BadRequestException so it still carries
 * a stable `code` through the global filter.
 */
export class BadRequestAppException extends AppException {
  constructor(
    message = 'This request could not be processed',
    details?: unknown,
  ) {
    super(message, HttpStatus.BAD_REQUEST, {
      code: ErrorCode.BAD_REQUEST,
      details,
    });
  }
}
