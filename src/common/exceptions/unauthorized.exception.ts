import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

export class UnauthorizedAppException extends AppException {
  constructor(message = 'You must be signed in to do this') {
    super(message, HttpStatus.UNAUTHORIZED, { code: ErrorCode.UNAUTHORIZED });
  }
}

/** Specifically wrong email/password — kept distinct from a generic 401 so the frontend can show a targeted message without leaking which field was wrong. */
export class InvalidCredentialsException extends AppException {
  constructor() {
    super('Incorrect email or password', HttpStatus.UNAUTHORIZED, {
      code: ErrorCode.INVALID_CREDENTIALS,
    });
  }
}
