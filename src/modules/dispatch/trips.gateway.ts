import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import type { Server } from 'socket.io';
import type { AuthenticatedSocket } from '#/common/types/authenticated-socket.type';
import { SupabaseJwtVerifierService } from '#/common/auth/supabase-jwt-verifier.service';
import { UsersService } from '#/modules/users/users.service';
import { TRIP_EVENTS, TripUpdatedEvent } from '#/common/events/trip.events';
import { DispatchService } from './dispatch.service';
import { TripsEmitterService } from './trips-emitter.service';
import { TripsSubscriptionRegistry } from './trips-subscription-registry.service';
import { ListTripsQueryDto } from './dto/list-trips.query.dto';

/** Same debounce reasoning as OrdersGateway — coalesces a burst of arrive/complete/skip events for one company into one recompute pass. */
const DEBOUNCE_MS = 250;

@WebSocketGateway({
  namespace: 'trips',
  cors: { origin: process.env.CLIENT_URL ?? true, credentials: true },
})
export class TripsGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly emitter: TripsEmitterService,
    private readonly registry: TripsSubscriptionRegistry,
    private readonly verifier: SupabaseJwtVerifierService,
    private readonly usersService: UsersService,
    private readonly dispatchService: DispatchService,
  ) {}

  afterInit(server: Server): void {
    this.emitter.setServer(server);
  }

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      socket.data.user = await this.verifier.verify(token);
    } catch {
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    await this.registry.remove(socket.id);
  }

  @SubscribeMessage('subscribe:trips')
  async handleSubscribe(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() query: ListTripsQueryDto) {
    if (!socket.data.user) return;

    const userRole = await this.usersService.getUserRoleByUserId(socket.data.user.id);
    await this.registry.set(socket.id, userRole.companyId, query);

    const result = await this.dispatchService.listTripsForCompanyWithDriverNames(userRole.companyId, query);
    socket.emit('trips:update', result);
  }

  @SubscribeMessage('unsubscribe:trips')
  async handleUnsubscribe(@ConnectedSocket() socket: AuthenticatedSocket) {
    await this.registry.remove(socket.id);
  }

  @OnEvent(TRIP_EVENTS.UPDATED)
  handleTripUpdated(event: TripUpdatedEvent) {
    this.scheduleRefresh(event.companyId);
  }

  private scheduleRefresh(companyId: string): void {
    if (this.pendingRefresh.has(companyId)) return;
    const timeout = setTimeout(() => {
      this.pendingRefresh.delete(companyId);
      void this.refreshSubscribersForCompany(companyId);
    }, DEBOUNCE_MS);
    this.pendingRefresh.set(companyId, timeout);
  }

  /** Groups subscribers by identical filter set before computing — same dedup reasoning as OrdersGateway. */
  private async refreshSubscribersForCompany(companyId: string): Promise<void> {
    const subscribers = await this.registry.getForCompany(companyId);
    if (subscribers.length === 0) return;

    const groups = new Map<string, { query: ListTripsQueryDto; socketIds: string[] }>();
    for (const { socketId, query } of subscribers) {
      const key = JSON.stringify(query);
      const group = groups.get(key);
      if (group) group.socketIds.push(socketId);
      else groups.set(key, { query, socketIds: [socketId] });
    }

    await Promise.all(
      Array.from(groups.values()).map(async ({ query, socketIds }) => {
        const result = await this.dispatchService.listTripsForCompanyWithDriverNames(companyId, query);
        for (const socketId of socketIds) {
          this.emitter.emitToSocket(socketId, 'trips:update', result);
        }
      }),
    );
  }
}