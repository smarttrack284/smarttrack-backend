import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '#/common/constants/error-code-enum';

export interface AppExceptionOptions {
  code?: ErrorCode | string;
  details?: unknown;
}

/**
 * Base class for every deliberate, business-logic-level error thrown by
 * this app (as opposed to unexpected bugs/driver errors, which the global
 * filter catches separately and never trusts to describe themselves safely
 * to the client).
 */
export class AppException extends HttpException {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    options: AppExceptionOptions = {},
  ) {
    super(message, status);
    this.code = options.code ?? ErrorCode.BAD_REQUEST;
    this.details = options.details;
  }
}
