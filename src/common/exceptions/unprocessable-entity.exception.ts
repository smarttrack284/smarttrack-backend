import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { ErrorCode } from '#/common/constants/error-code-enum';

/**
 * The request is well-formed and passes validation, but violates a business
 * rule that makes it impossible to fulfill right now — e.g. assigning a
 * driver who's marked offline, or creating an order with zero items.
 */
export class UnprocessableEntityException extends AppException {
  constructor(message: string, details?: unknown) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, {
      code: ErrorCode.UNPROCESSABLE_ENTITY,
      details,
    });
  }
}

/**
 * Specifically an invalid status transition — e.g. trying to mark a
 * `delivered` order as `picked_up`, or skipping a stop that's already
 * `completed`. Mirrors the state machine already defined in the frontend's
 * order-status.ts / getOrderActions, so the backend can enforce the exact
 * same allowed transitions rather than trusting the client's UI gating.
 */
export class InvalidStateTransitionException extends AppException {
  constructor(entity: string, from: string, to: string) {
    super(
      `Cannot change ${entity} status from "${from}" to "${to}"`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      {
        code: ErrorCode.INVALID_STATE_TRANSITION,
        details: { entity, from, to },
      },
    );
  }
}
