import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedAppException } from '#/common/exceptions';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';

/**
 * Verifies a Supabase-issued JWT entirely locally, against project's
 * shared JWT secret — no call to Supabase's API, no database query. This
 * is deliberate: this guard runs on most authenticated routes in the app,
 * so it needs to be cheap enough to not become a bottleneck or add load
 * to Postgres on every single request.
 *

 *
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new Error('SUPABASE_JWT_SECRET is not configured');
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedAppException('Missing bearer token');
    }

    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;
      request.user = this.mapPayloadToUser(payload);
      return true;
    } catch (error) {
      throw new UnauthorizedAppException('Invalid or expired token');
    }
  }

  private extractToken(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim();
  }

  private mapPayloadToUser(payload: jwt.JwtPayload): AuthenticatedUser {
    if (!payload.sub) {
      throw new UnauthorizedAppException('Token is missing a subject claim');
    }
    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      metadata:
        typeof payload.user_metadata === 'object' &&
        payload.user_metadata !== null
          ? (payload.user_metadata as Record<string, unknown>)
          : {},
    };
  }
}
