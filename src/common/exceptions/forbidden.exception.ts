import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

export class ForbiddenAppException extends AppException {
  constructor(message = 'You do not have access to this resource') {
    super(message, HttpStatus.FORBIDDEN, { code: ErrorCode.FORBIDDEN });
  }
}

/**
 * Signed in, resource exists, but the account's role doesn't permit the
 * action — e.g. a dispatcher attempting an owner-only action like changing
 * billing. Distinct from ForbiddenAppException so the frontend can show
 * "your role doesn't allow this" rather than a generic access-denied.
 */
export class InsufficientPermissionsException extends AppException {
  constructor(requiredRole?: string) {
    const message = requiredRole
      ? `This action requires the "${requiredRole}" role`
      : 'Your role does not permit this action';
    super(message, HttpStatus.FORBIDDEN, {
      code: ErrorCode.INSUFFICIENT_PERMISSIONS,
      details: requiredRole ? { requiredRole } : undefined,
    });
  }
}
