import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UnauthorizedAppException } from '#/common/exceptions';
import { SupabaseJwtVerifierService } from '#/common/auth/supabase-jwt-verifier.service';
import type { AuthenticatedSocket } from '#/common/types/authenticated-socket.type';

/**
 * For events that REQUIRE an authenticated user (subscribing to the
 * internal trip room) — NOT applied at the gateway/connection level,
 * since public tracking clients must be able to connect with no token at
 * all. Applied per-@SubscribeMessage handler instead, via @UseGuards on
 * that specific method.
 */
@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly verifier: SupabaseJwtVerifierService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const socket = context.switchToWs().getClient<AuthenticatedSocket>();

    if (socket.data.user) return true; // already verified at handshake, see TrackingGateway.handleConnection

    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) throw new UnauthorizedAppException('Missing auth token');

    socket.data.user = await this.verifier.verify(token);
    return true;
  }
}
