import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

export class PayloadTooLargeException extends AppException {
  constructor(maxSizeLabel?: string) {
    const message = maxSizeLabel
      ? `File exceeds the maximum allowed size of ${maxSizeLabel}`
      : 'File exceeds the maximum allowed size';
    super(message, HttpStatus.PAYLOAD_TOO_LARGE, {
      code: ErrorCode.PAYLOAD_TOO_LARGE,
    });
  }
}
