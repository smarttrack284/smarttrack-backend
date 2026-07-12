import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

export class ResourceConflictException extends AppException {
  constructor(message: string, details?: unknown) {
    super(message, HttpStatus.CONFLICT, { code: ErrorCode.CONFLICT, details });
  }
}
