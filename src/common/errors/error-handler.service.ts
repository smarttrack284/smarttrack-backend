import { Injectable, Logger } from '@nestjs/common';
import { AppException } from '#/common/exceptions/app.exception';
import { InternalErrorException } from '#/common/exceptions/internal-error.exception';

export type ErrorRule<E extends Error = Error> = {
  /** The error class this rule matches — checked via `instanceof`. */
  instanceOf: new (...args: any[]) => E;
  /** Builds the AppException to throw when this rule matches. */
  toException: (error: E) => AppException;
};

/** Small helper so call sites read as a declarative list. */
export function rule<E extends Error>(
  instanceOf: new (...args: any[]) => E,
  toException: (error: E) => AppException,
): ErrorRule<E> {
  return { instanceOf, toException };
}

@Injectable()
export class ErrorHandlerService {
  private readonly logger = new Logger(ErrorHandlerService.name);

  /**
   * Normalises an unexpected error into a safe AppException.
   *
   * - Deliberate business exceptions (AppException subclasses) are
   *   re‑thrown unchanged – they already carry the correct HTTP status
   *   and client‑safe message.
   * - Raw library/driver errors are matched against the supplied rules
   *   and transformed into the appropriate AppException.
   * - Anything unrecognised becomes a generic InternalErrorException.
   *
   * @param context Convention: `"ClassName.methodName"`.
   */
  handle(error: unknown, context: string, rules: ErrorRule[] = []): never {
    // 1. Deliberate business exceptions – pass through as‑is
    if (error instanceof AppException) {
      this.logger.warn(`[${context}] ${error.constructor.name}: ${error.message}`);
      throw error;
    }

    // 2. Apply translation rules for raw library/driver errors
    for (const r of rules) {
      if (error instanceof r.instanceOf) {
        const mapped = r.toException(error);
        this.logger.warn(
          `[${context}] ${error.constructor.name} -> ${mapped.constructor.name}: ${error.message}`,
        );
        throw mapped;
      }
    }

    // 3. Genuinely unknown – log full detail, return generic 500
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`[${context}] Unhandled error: ${err.message}`, err.stack);
    throw new InternalErrorException(
      'An unexpected error occurred. Please try again later.',
    );
  }
}