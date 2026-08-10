import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import type { Server } from 'socket.io';
import { WsAuthGuard } from '#/common/guards/ws-auth.guard';
import { SupabaseJwtVerifierService } from '#/common/auth/supabase-jwt-verifier.service';
import type { AuthenticatedSocket } from '#/common/types/authenticated-socket.type';
import { TrackingEmitterService } from './tracking-emitter.service';
import { TrackingService } from './tracking.service';
import { parse } from 'cookie';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import { UsersService } from '#/modules/users/users.service';

const USER_ROLE_CACHE_TTL = 60;


@WebSocketGateway({
  namespace: 'tracking',
  cors: { origin: process.env.CLIENT_URL ?? true, credentials: true },
})
export class TrackingGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private logger: Logger =  new Logger(TrackingGateway.name)

  constructor(
    private readonly emitter: TrackingEmitterService,
    private readonly trackingService: TrackingService,
    private readonly verifier: SupabaseJwtVerifierService,
    private readonly  cache: RedisCacheService,
    private readonly usersService: UsersService,
  ) {}

  afterInit(server: Server): void {
    this.emitter.setServer(server);
  }

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    // Extract access token from the httpOnly cookie sent with the upgrade request
    const rawCookie = socket.request.headers.cookie ?? '';
    const cookies = parse(rawCookie);
    const token = cookies['sb-access-token'];

    if (!token) {
      this.logger.warn(
        `Socket ${socket.id} missing access token – disconnecting`,
      );
      socket.disconnect(true);
      return;
    }

    try {
      // 1. Verify JWT (exactly what SupabaseAuthGuard does)
      const payload = await this.verifier.verify(token);
      socket.data.user = payload;

      // 2. Enrich socket with companyId & role (cached, same as guards)
      const userId: string = payload.id;
      const userRole = await this.cache.getOrSet<{
        companyId: string;
        role: string;
        status: string;
      } | null>(`user:company:${userId}`, USER_ROLE_CACHE_TTL, async () => {
        const role = await this.usersService.getUserRoleByUserId(userId);
        return role
          ? {
              companyId: role.companyId,
              role: role.role,
              status: role.status,
            }
          : null;
      });

      if (!userRole || userRole.status !== 'active') {
        this.logger.warn(
          `Socket ${socket.id} user ${userId} has no active company role`,
        );
        socket.disconnect(true);
        return;
      }

      // Enrich socket data with companyId
      socket.data.user.companyId = userRole.companyId;
      // Also store role if needed (optional)
      socket.data.user.role = userRole.role;
    } catch (err) {
      this.logger.error(
        `Connection auth error for socket ${socket.id}`,
        (err as Error).stack,
      );
      socket.disconnect(true);
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('subscribe:trip')
  async handleSubscribeTrip(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: { tripId: string },
  ) {
    await this.trackingService.assertUserCanAccessTrip(
      socket.data.user!.id,
      body.tripId,
    );
    await socket.join(`trip:${body.tripId}:internal`);
    return this.trackingService.broadcastTripUpdate(body.tripId); // sends an immediate snapshot, not just future updates
  }

  @SubscribeMessage('unsubscribe:trip')
  handleUnsubscribeTrip(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: { tripId: string },
  ) {
    socket.leave(`trip:${body.tripId}:internal`);
  }

  /**
   * No guard — deliberately open. The tracking number itself IS the
   * credential; there's no account to authenticate. Anyone who knows a
   * valid tracking number can watch that one order's status, which is the
   * intended public-tracking behavior (same as any courier's public
   * tracking page).
   */
  @SubscribeMessage('subscribe:tracking')
  async handleSubscribeTracking(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: { trackingNumber: string },
  ) {
    const snapshot =
      await this.trackingService.getPublicSnapshotByTrackingNumber(
        body.trackingNumber,
      );
    await socket.join(`tracking:${body.trackingNumber}`);
    socket.emit('tracking:update', snapshot);
  }

  @SubscribeMessage('unsubscribe:tracking')
  handleUnsubscribeTracking(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: { trackingNumber: string },
  ) {
    socket.leave(`tracking:${body.trackingNumber}`);
  }
}
