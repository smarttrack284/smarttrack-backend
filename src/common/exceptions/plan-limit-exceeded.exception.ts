import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '../constants/error-code-enum';

/**
 * Thrown SPECIFICALLY when a plan's usage limit (orders, team members,
 * etc.) is hit — distinct from UnprocessableEntityException's general
 * "well-formed but violates a business rule" case. This exists so
 * callers that need to react differently to "you hit your plan limit"
 * (like the CSV import loop stopping early) can check for it via a
 * precise `instanceof`, rather than inferring intent from a generic
 * exception type that unrelated failures could also throw.
 */
export class PlanLimitExceededException extends AppException {
  constructor(limitType: 'orders' | 'team_members', limit: number) {
    super(
      `This workspace has reached its plan's limit of ${limit} ${limitType.replace('_', ' ')}. Upgrade to continue.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { code: ErrorCode.UNPROCESSABLE_ENTITY, details: { limitType, limit } },
    );
  }
}
