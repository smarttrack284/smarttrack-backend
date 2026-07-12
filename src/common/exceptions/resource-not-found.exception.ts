import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

export class ResourceNotFoundException extends AppException {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier
      ? `${resource} with id "${identifier}" was not found`
      : `${resource} was not found`;
    super(message, HttpStatus.NOT_FOUND, { code: ErrorCode.NOT_FOUND });
  }
}
