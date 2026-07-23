import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

export class ResourceNotFoundException extends AppException {
  constructor(message:string) {
    
    super(message, HttpStatus.NOT_FOUND, { code: ErrorCode.NOT_FOUND });
  }
}
