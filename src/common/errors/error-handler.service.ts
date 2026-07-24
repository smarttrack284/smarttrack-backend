import { Injectable, Logger } from '@nestjs/common';
import { AppException } from '#/common/exceptions/app.exception';
import { InternalErrorException } from '#/common/exceptions/internal-error.exception';

export type ErrorRule<E extends Error = Error> = {
  /** The error class this rule matches — checked via `instanceof`, not a string/code comparison, so subclasses match correctly too. */
  instanceOf: new (...args: any[]) => E;
  /** Builds the AppException to actually throw when this rule matches. */
  toException: (error: E) => AppException;
};

/** Small helper so call sites read as a declarative list rather than raw object literals. */
export function rule<E extends Error>(
  instanceOf: new (...args: any[]) => E,
  toException: (error: E) => AppException,
): ErrorRule<E> {
  return { instanceOf, toException };
}

/**
 * The one place a caught, unexpected error gets turned into the right
 * AppException — used inside a service method's catch block, not inside
 * the global filter (which only handles what's already been thrown, it
 * doesn't decide HOW to translate a raw driver/library error into a
 * meaningful one in the first place).
 *
 * Usage:
 *   try {
 *     await this.repo.save(entity);
 *   } catch (err) {
 *     this.errorHandler.handle(err, 'OrdersService.createOrder', [
 *       rule(QueryFailedError, (e) =>
 *         e.message.includes('duplicate key')
 *           ? new ResourceConflictException('An order with this tracking number already exists')
 *           : new InternalErrorException(e.message),
 *       ),
 *     ]);
 *   }
 *
 * `context` is a plain string, not auto-detected from a stack trace —
 * explicit and reliable beats "clever" here. Convention: "ClassName.methodName".
 */
@Injectable()
export class ErrorHandlerService {
  private readonly logger = new Logger(ErrorHandlerService.name);

  handle(error: unknown, context: string, rules: ErrorRule[] = []): never {
    for (const r of rules) {
      if (error instanceof r.instanceOf) {
        const mapped = r.toException(error);
        this.logger.warn(
          `[${context}] ${error.constructor.name} -> ${mapped.constructor.name}: ${error.message}`,
        );
        throw mapped;
      }
    }

    // Already a deliberate business exception (e.g. rethrown from a
    // nested service call) — log lightly and pass it through unchanged,
    // don't wrap an AppException inside another one.
    if (error instanceof AppException) {
      this.logger.warn(`[${context}] ${error.constructor.name}: ${error.message}`);
      throw error;
    }

    // Genuinely unrecognized — this is exactly the case the global filter
    // treats as a 500. Log the FULL detail here (message + stack), since
    // this is the one place that detail is still available; the client
    // only ever sees InternalErrorException's generic message.
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`[${context}] Unhandled error: ${err.message}`, err.stack);
    throw new InternalErrorException("An unexpected error occurred. Please try again later.");
  }
}