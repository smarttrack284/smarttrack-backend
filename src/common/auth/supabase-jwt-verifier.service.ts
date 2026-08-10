import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';
import { UnauthorizedAppException } from '#/common/exceptions';

export type VerifiedAuthPayload = {
  id: string; 
  email: string;
  sessionId: string | undefined;
  metadata: Record<string, unknown>;
};

/**
 * The ONE place Supabase JWT verification happens. Both SupabaseAuthGuard
 * (REST) and WsAuthGuard (websockets) call this.
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

  async verify(token: string): Promise<VerifiedAuthPayload> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        algorithms: ['ES256'],
      });
      return this.mapPayloadToUser(payload);
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }
  }

  private mapPayloadToUser(payload: JWTPayload): VerifiedAuthPayload {
    if (!payload.sub) {
      throw new UnauthorizedAppException('Token is missing a subject claim');
    }
    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      sessionId:
        typeof payload.session_id === 'string' ? payload.session_id : undefined,
      metadata:
        typeof payload.user_metadata === 'object' &&
        payload.user_metadata !== null
          ? (payload.user_metadata as Record<string, unknown>)
          : {},
    };
  }
}
