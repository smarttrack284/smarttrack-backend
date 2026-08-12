import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenAppException,
  UnauthorizedAppException,
} from '#/common/exceptions';
import { SupabaseJwtVerifierService } from '#/common/auth/supabase-jwt-verifier.service';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '#/common/entities/user-role.entity';
import { TeamMemberStatus } from '#/common/constants/team-member-status.constant';
import * as Sentry from '@sentry/node';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private static readonly USER_COMPANY_CACHE_TTL = 300; // seconds
  private readonly logger = new Logger(SupabaseAuthGuard.name);
  private readonly supabaseUrl: string;
  private readonly supabasePublishableKey: string;

  constructor(
    private readonly verifier: SupabaseJwtVerifierService,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
  ) {
    this.supabaseUrl = this.config.get<string>('SUPABASE_URL')!;
    this.supabasePublishableKey = this.config.get<string>(
      'SUPABASE_PUBLISHABLE_KEY',
    )!;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    // Get token ONLY from the httpOnly cookie
    let token = request.cookies?.['sb-access-token'] ?? null;

    // If no access token, try silent refresh using the refresh token cookie
    if (!token) {
      const refreshToken = request.cookies?.['sb-refresh-token'];
      if (refreshToken) {
        try {
          const newTokens = await this.refreshTokens(refreshToken);
          this.setCookies(
            reply,
            newTokens.accessToken,
            newTokens.refreshToken,
            newTokens.expiresIn,
          );
          token = newTokens.accessToken;
        } catch (refreshErr) {
          this.clearCookies(request, reply);
          throw new UnauthorizedAppException(
            'Session expired. Please log in again.',
          );
        }
      } else {
        throw new UnauthorizedAppException('Missing session cookie');
      }
    }

    // Verify the token (may be the original or a freshly refreshed one)
    let payload: Awaited<ReturnType<typeof this.verifier.verify>>;
    try {
      payload = await this.verifier.verify(token);
    } catch (verifyErr) {
      // If verification fails (likely expired), attempt a refresh if we have a refresh token
      const refreshToken = request.cookies?.['sb-refresh-token'];
      if (refreshToken) {
        try {
          const newTokens = await this.refreshTokens(refreshToken);
          this.setCookies(
            reply,
            newTokens.accessToken,
            newTokens.refreshToken,
            newTokens.expiresIn,
          );
          payload = await this.verifier.verify(newTokens.accessToken);
        } catch (refreshErr) {
          this.clearCookies(request, reply);
          throw new UnauthorizedAppException(
            'Session expired. Please log in again.',
          );
        }
      } else {
        throw verifyErr; // no refresh token – fail as usual
      }
    }

    // ── Session blacklist check ──
    if (payload.sessionId) {
      const blacklisted = await this.cache.get(
        `revoked-session:${payload.sessionId}`,
      );
      if (blacklisted) {
        this.logger.warn(
          `Auth failed: session ${
            payload.sessionId
          } has been revoked [reqId: ${this.getRequestId(request)}]`,
        );
        throw new UnauthorizedAppException('Session has been revoked');
      }
    }

    const userId = payload.id;
    const membership = await this.cache.getOrSet<Pick<
      UserRole,
      'companyId' | 'role' | 'status' | 'name'
    > | null>(
      `user:company:${userId}`,
      SupabaseAuthGuard.USER_COMPANY_CACHE_TTL,
      async () =>
        this.userRoleRepo.findOne({
          where: { userId },
          select: {
            companyId: true,
            role: true,
            status: true,
            name: true,
          },
        }),
    );

    if (!membership) {
      this.logger.warn(
        `Auth failed: no UserRole for ${userId} [reqId: ${this.getRequestId(
          request,
        )}]`,
      );
      throw new ForbiddenAppException(
        'Your account is not associated with any company',
      );
    }
    if (membership.status !== TeamMemberStatus.ACTIVE) {
      this.logger.warn(
        `Auth failed: inactive status ${
          membership.status
        } for ${userId} [reqId: ${this.getRequestId(request)}]`,
      );
      throw new ForbiddenAppException(
        'Your account is not active. Please contact your administrator.',
      );
    }

    // Enrich the request for downstream controllers
    (request as any).user = {
      ...payload,
      name: membership.name,
      companyId: membership.companyId,
      role: membership.role,
    };

    // Attach user context to Sentry for error tracking
    Sentry.setUser({
      id: payload.id,
      name: membership.name,
      email: payload.email,
      companyId: membership.companyId,
      role: membership.role,
    });

    return true;
  }

  /**
   * Calls Supabase's token refresh endpoint using the long‑lived refresh token.
   */
  private async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const response = await fetch(
      `${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.supabasePublishableKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );

    if (!response.ok) {
      throw new Error('Refresh token exchange failed');
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Sets access and refresh tokens as httpOnly cookies on the response.
   */
  private setCookies(
    reply: FastifyReply,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ) {
    const isProd = process.env.NODE_ENV === 'production';
    reply.setCookie('sb-access-token', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/',
      maxAge: expiresIn,
    });
    reply.setCookie('sb-refresh-token', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  /**
   * Clears ALL cookies whose name starts with "sb-". This ensures any
   * Supabase-issued cookie (access, refresh, PKCE verifier, etc.) is
   * removed when the session is invalidated or expires.
   */
  private clearCookies(request: FastifyRequest, reply: FastifyReply) {
    const cookieNames = Object.keys(request.cookies);
    for (const name of cookieNames) {
      if (name.startsWith('sb-')) {
        reply.clearCookie(name, { path: '/' });
      }
    }
  }

  /**
   * Extracts the access token ONLY from the httpOnly cookie.
   * The Authorization header is deliberately ignored – tokens must
   * never be accessible to JavaScript.
   */
  private extractToken(request: FastifyRequest): string | null {
    return request.cookies?.['sb-access-token'] ?? null;
  }

  private getRequestId(request: FastifyRequest): string {
    return String(request.id ?? 'unknown');
  }
}