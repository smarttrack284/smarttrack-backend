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
import {
  ORDER_EVENTS,
  OrderCreatedEvent,
  OrderDeletedEvent,
  OrderStatusChangedEvent,
} from '#/common/events/order.events';
import { OrdersService } from './orders.service';
import { OrdersEmitterService } from './orders-emitter.service';
import { OrdersSubscriptionRegistry } from './orders-subscription-registry.service';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';

/**
 * Debounce window for coalescing bursts of events into one recompute pass —
 * e.g. a dispatcher batch-dispatching 10 order at once fires 10
 * OrderStatusChangedEvents in quick succession; without this, that's 10
 * separate recompute-and-emit passes instead of 1.
 *
 * Deliberately kept as an in-memory Map, NOT moved to Redis like the
 * subscription registry — this is a pure performance optimization, not a
 * correctness concern. Worst case if two instances both schedule their own
 * debounce timer for the same company, the work happens twice instead of
 * once; nobody misses an update. That asymmetry (registry MUST be shared,
 * debounce timer doesn't need to be) is why only one of the two moved to
 * Redis.
 */
const DEBOUNCE_MS = 250;

@WebSocketGateway({
  namespace: 'orders',
  cors: { origin: process.env.CLIENT_URL ?? true, credentials: true },
})
export class OrdersGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly pendingRefresh = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly emitter: OrdersEmitterService,
    private readonly registry: OrdersSubscriptionRegistry,
    private readonly verifier: SupabaseJwtVerifierService,
    private readonly usersService: UsersService,
    private readonly ordersService: OrdersService,
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

  @SubscribeMessage('subscribe:order')
  async handleSubscribe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() query: ListOrdersQueryDto,
  ) {
    if (!socket.data.user) return;

    const userRole = await this.usersService.getUserRoleByUserId(
      socket.data.user.id,
    );
    await this.registry.set(socket.id, userRole.companyId, query);

    const result = await this.ordersService.listOrdersForCompanyCached(
      userRole.companyId,
      query,
    );
    socket.emit('order:update', result);
  }

  @SubscribeMessage('unsubscribe:order')
  async handleUnsubscribe(@ConnectedSocket() socket: AuthenticatedSocket) {
    await this.registry.remove(socket.id);
  }

  @OnEvent(ORDER_EVENTS.CREATED)
  handleOrderCreated(event: OrderCreatedEvent) {
    this.scheduleRefresh(event.payload.companyId);
  }

  @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
  handleOrderStatusChanged(event: OrderStatusChangedEvent) {
    this.scheduleRefresh(event.payload.companyId);
  }

  @OnEvent(ORDER_EVENTS.DELETED)
  handleOrderDeleted(event: OrderDeletedEvent) {
    this.scheduleRefresh(event.payload.companyId);
  }

  /** Coalesces rapid-fire events for the same company into one recompute pass, DEBOUNCE_MS after the first event in a burst. */
  private scheduleRefresh(companyId: string): void {
    if (this.pendingRefresh.has(companyId)) return;

    const timeout = setTimeout(() => {
      this.pendingRefresh.delete(companyId);
      void this.refreshSubscribersForCompany(companyId);
    }, DEBOUNCE_MS);

    this.pendingRefresh.set(companyId, timeout);
  }

  /**
   * Groups subscribers by their EXACT filter set before computing anything
   * — if five dispatchers all have the default (no filter) view open,
   * that's one query, not five, with the single result fanned out to all
   * five sockets. Only genuinely distinct filter combinations trigger
   * separate queries.
   */
  private async refreshSubscribersForCompany(companyId: string): Promise<void> {
    const subscribers = await this.registry.getForCompany(companyId);
    if (subscribers.length === 0) return;

    const groups = new Map<
      string,
      { query: ListOrdersQueryDto; socketIds: string[] }
    >();

    for (const { socketId, query } of subscribers) {
      const cacheKey = this.ordersService.buildOrdersListCacheKey(
        companyId,
        query,
      );
      const group = groups.get(cacheKey);
      if (group) {
        group.socketIds.push(socketId);
      } else {
        groups.set(cacheKey, { query, socketIds: [socketId] });
      }
    }

    await Promise.all(
      Array.from(groups.entries()).map(
        async ([cacheKey, { query, socketIds }]) => {
          await this.ordersService.invalidateOrdersListCache(cacheKey);
          const result = await this.ordersService.listOrdersForCompanyCached(
            companyId,
            query,
          );
          for (const socketId of socketIds) {
            this.emitter.emitToSocket(socketId, 'order:update', result);
          }
        },
      ),
    );
  }
}
