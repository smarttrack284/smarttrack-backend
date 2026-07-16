import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { UnauthorizedAppException } from '#/common/exceptions';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';

/**
 * The ONE place Supabase JWT verification happens. SupabaseAuthGuard (REST)
 * and WsAuthGuard (sockets) both call this instead of each maintaining
 * their own JWKS client — a single verification path is what guarantees
 * a token that's valid over REST is valid over the socket connection too,
 * with no drift between the two.
 */
@Injectable()
export class SupabaseJwtVerifierService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(config: ConfigService) {
    const supabaseUrl = config.get<string>('SUPABASE_URL');
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL is not configured');
    }
    this.issuer = `${supabaseUrl}/auth/v1`;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
      {
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
      },
    );
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        algorithms: ['ES256'], // see the earlier caveat about confirming your project's actual signing algorithm
      });
      return this.mapPayloadToUser(payload);
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }
  }

  private mapPayloadToUser(payload: JWTPayload): AuthenticatedUser {
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
