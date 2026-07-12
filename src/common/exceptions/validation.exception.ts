import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

/**
 * For validation failures raised manually inside a service — business-rule
 * checks that ValidationPipe/DTO decorators can't express (e.g. "dropoff
 * location must differ from pickup location"). ValidationPipe's own
 * BadRequestException is still handled separately by the global filter and
 * doesn't need this class.
 */
export class ValidationException extends AppException {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message, HttpStatus.BAD_REQUEST, {
      code: ErrorCode.VALIDATION_ERROR,
      details: fieldErrors,
    });
  }
}
