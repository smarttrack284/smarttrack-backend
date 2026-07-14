import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';

/**
 * Reads the user attached by SupabaseAuthGuard. Only safe to use on routes
 * that are actually behind @UseGuards(SupabaseAuthGuard) — otherwise
 * request.user is undefined and this decorator returns undefined too, no
 * error, which would silently break downstream code expecting a real user.
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return request.user as AuthenticatedUser;
  },
);
