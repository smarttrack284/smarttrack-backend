import {ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,} from '@nestjs/common';
import type {FastifyReply, FastifyRequest} from 'fastify';
import * as Sentry from '@sentry/node';
import {AppException} from '#/common/exceptions/app.exception';
import {ErrorCode} from '#/common/constants/error-code-enum';
import {buildErrorResponse} from '../utils/error-response.util';

type ResolvedError = {
  status: number;
  code: string;
  message: string | string[];
  details?: unknown;
};

/**
 * Catches every exception thrown anywhere in the app — deliberate
 * AppExceptions, Nest's built-in HttpExceptions (including ValidationPipe's
 * BadRequestException), and truly unexpected errors (driver failures, bugs).
 *
 * Normalizes all of them into one consistent response shape, and never lets
 * an unexpected error's raw message/stack leak to the client — those get
 * logged in full server-side and replaced with a generic message in the
 * response.
 *
 * Sentry integration:
 * - Only errors with a resolved status >= 500 (unexpected, bugs) are sent to
 *   Sentry. Expected business errors (4xx, including AppException subclasses)
 *   are intentionally NOT reported to keep the Sentry dashboard clean and
 *   focused on real problems. User context (id, email, company) is set in
 *   the SupabaseAuthGuard and automatically attached to any captured event.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    const resolved = this.resolve(exception);
    const requestId =
      typeof request.id === 'string' ? request.id : String(request.id);

    const body = buildErrorResponse({
      statusCode: resolved.status,
      code: resolved.code,
      message: resolved.message,
      details: resolved.details,
      path: request.url,
      method: request.method,
      requestId,
      // Stack traces are a debugging convenience for local/dev only — never
      // shipped to a real client in production.
      stack:
        !this.isProduction &&
        resolved.status >= 500 &&
        exception instanceof Error
          ? exception.stack
          : undefined,
    });

    this.log(exception, resolved.status, request, requestId);

    // ---------- Sentry: only report real problems (5xx / unknown) ----------
    if (resolved.status >= 500) {
      Sentry.captureException(exception);
    }
    // -----------------------------------------------------------------------

    reply.status(resolved.status).send(body);
  }

  private resolve(exception: unknown): ResolvedError {
    // Our own deliberate business exceptions already carry a stable code.
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    // Everything else Nest itself throws — NotFoundException,
    // ForbiddenException, and critically ValidationPipe's
    // BadRequestException (whose response.message is an array of per-field
    // validation errors when whitelist/forbidNonWhitelisted are on, as in
    // your main.ts).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response
      ) {
        const responseMessage = (response as Record<string, unknown>).message;
        return {
          status,
          code: this.codeForStatus(status),
          message: Array.isArray(responseMessage)
            ? (responseMessage as string[])
            : String(responseMessage),
        };
      }

      return {
        status,
        code: this.codeForStatus(status),
        message: typeof response === 'string' ? response : exception.message,
      };
    }

    // Anything unrecognized — a real bug, an unhandled driver/db error, etc.
    // Deliberately generic in the response; the real detail goes to the log.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again.',
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.UNPROCESSABLE_ENTITY;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.PAYLOAD_TOO_LARGE;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.BAD_REQUEST;
    }
  }

  private log(
    exception: unknown,
    status: number,
    request: FastifyRequest,
    requestId: string,
  ) {
    const context = `[${requestId}] ${request.method} ${request.url} -> ${status}`;
    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      // InternalErrorException stashes the real diagnostic detail on `.cause`
      // rather than the client-facing `.message` — log it explicitly so it's
      // not silently lost.
      const cause =
        exception instanceof Error && exception.cause instanceof Error
          ? `\nCause: ${exception.cause.message}`
          : '';
      this.logger.error(`${context}${cause}`, stack);
    } else {
      this.logger.warn(context);
    }
  }
}
