import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import type { Server } from 'socket.io';
import { WsAuthGuard } from '#/common/guards/ws-auth.guard';
import { SupabaseJwtVerifierService } from '#/common/auth/supabase-jwt-verifier.service';
import type { AuthenticatedSocket } from '#/common/types/authenticated-socket.type';
import { TrackingEmitterService } from './tracking-emitter.service';
import { TrackingService } from './tracking.service';

@WebSocketGateway({
  namespace: 'tracking',
  cors: { origin: process.env.CLIENT_URL ?? true, credentials: true },
})
export class TrackingGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly emitter: TrackingEmitterService,
    private readonly trackingService: TrackingService,
    private readonly verifier: SupabaseJwtVerifierService,
  ) {}

  afterInit(server: Server): void {
    this.emitter.setServer(server);
  }

  /**
   * Best-effort auth at connection time — a token here means "this socket
   * is a signed-in user," but does NOT by itself grant access to any room.
   * A missing token is fine (public tracking clients have none); an
   * INVALID token disconnects immediately, since presenting a bad token is
   * different from presenting none at all.
   */
  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return;

    try {
      socket.data.user = await this.verifier.verify(token);
    } catch {
      socket.disconnect(true);
    }
  }

  /** Requires auth (WsAuthGuard) AND company membership (assertUserCanAccessTrip) — two separate checks, neither sufficient alone. */
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
