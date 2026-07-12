import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

/**
 * The request itself was fine, but a downstream dependency this endpoint
 * relies on (Radar's routing API, Supabase, an email provider, etc.) failed
 * or is unreachable. Kept separate from a generic 500 so ops/monitoring can
 * distinguish "our bug" from "a third party is down."
 */
export class ExternalServiceException extends AppException {
  constructor(serviceName: string, message?: string) {
    super(
      message ??
        `${serviceName} is currently unavailable. Please try again shortly.`,
      HttpStatus.BAD_GATEWAY,
      { code: ErrorCode.BAD_GATEWAY, details: { service: serviceName } },
    );
  }
}

export class ServiceUnavailableException extends AppException {
  constructor(message = 'This service is temporarily unavailable') {
    super(message, HttpStatus.SERVICE_UNAVAILABLE, {
      code: ErrorCode.SERVICE_UNAVAILABLE,
    });
  }
}

export class UpstreamTimeoutException extends AppException {
  constructor(serviceName?: string) {
    const message = serviceName
      ? `Timed out waiting for a response from ${serviceName}`
      : 'The request timed out';
    super(message, HttpStatus.GATEWAY_TIMEOUT, { code: ErrorCode.TIMEOUT });
  }
}
