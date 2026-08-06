import {
    ConnectedSocket,
    MessageBody,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer
} from "@nestjs/websockets";
import { OnEvent } from "@nestjs/event-emitter";
import { Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import type { AuthenticatedSocket } from "#/common/types/authenticated-socket.type";
import { SupabaseJwtVerifierService } from "#/common/auth/supabase-jwt-verifier.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { UsersService } from "#/modules/users/users.service";
import {
    ORDER_EVENTS,
    OrderCreatedEvent,
    OrderDeletedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";
import { OrdersService } from "./orders.service";
import { OrdersEmitterService } from "./orders-emitter.service";
import { OrdersSubscriptionRegistry } from "./orders-subscription-registry.service";
import { ListOrdersQueryDto } from "./dto/list-orders.query.dto";

const DEBOUNCE_MS = 250;
const USER_ROLE_CACHE_TTL = 60;

@WebSocketGateway({
    namespace: "orders",
    cors: { origin: process.env.CLIENT_URL ?? true, credentials: true }
})
export class OrdersGateway implements OnGatewayInit, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(OrdersGateway.name);
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
        private readonly cache: RedisCacheService // added
    ) {}

    afterInit(server: Server): void {
        this.emitter.setServer(server);
    }

    async handleConnection(socket: AuthenticatedSocket): Promise<void> {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) {
            this.logger.warn(
                `Socket ${socket.id} missing token – disconnecting`
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
            } | null>(
                `user:company:${userId}`,
                USER_ROLE_CACHE_TTL,
                async () => {
                    const role =
                        await this.usersService.getUserRoleByUserId(userId);
                    return role
                        ? {
                              companyId: role.companyId,
                              role: role.role,
                              status: role.status
                          }
                        : null;
                }
            );

            if (!userRole || userRole.status !== "active") {
                this.logger.warn(
                    `Socket ${socket.id} user ${userId} has no active company role`
                );
                socket.disconnect(true);
                return;
            }

            socket.data.user.companyId = userRole.companyId;
        } catch (err) {
            this.logger.error(
                `Connection auth error for socket ${socket.id}`,
                (err as Error).stack
            );
            socket.disconnect(true);
        }
    }

    async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
        try {
            await this.registry.remove(socket.id);
        } catch (err) {
            this.logger.error(
                `Failed to remove subscription on disconnect for socket ${socket.id}`,
                (err as Error).stack
            );
        }
    }

    @SubscribeMessage("subscribe:order")
    async handleSubscribe(
        @ConnectedSocket() socket: AuthenticatedSocket,
        @MessageBody() query: ListOrdersQueryDto
    ) {
        const companyId = socket.data.user.companyId;
        if (!companyId) {
            socket.emit("error", { message: "Authentication required" });
            return;
        }

        try {
            // Register subscription in Redis
            await this.registry.set(socket.id, companyId, query);

            // Fetch initial data
            const result = await this.ordersService.listOrdersForCompanyCached(
                companyId,
                query
            );
            socket.emit("order:update", result);
        } catch (err) {
            this.logger.error(
                `Failed to subscribe socket ${socket.id} for company ${companyId}`,
                (err as Error).stack
            );
            // Send a generic error to the client, not raw details
            socket.emit("error", {
                message:
                    "Failed to subscribe to order updates. Please try again."
            });
        }
    }

    @SubscribeMessage("unsubscribe:order")
    async handleUnsubscribe(@ConnectedSocket() socket: AuthenticatedSocket) {
        try {
            await this.registry.remove(socket.id);
        } catch (err) {
            this.logger.error(
                `Failed to unsubscribe socket ${socket.id}`,
                (err as Error).stack
            );
        }
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

    private scheduleRefresh(companyId: string): void {
        if (this.pendingRefresh.has(companyId)) return;

        const timeout = setTimeout(() => {
            this.pendingRefresh.delete(companyId);
            void this.refreshSubscribersForCompany(companyId);
        }, DEBOUNCE_MS);

        this.pendingRefresh.set(companyId, timeout);
    }

    private async refreshSubscribersForCompany(
        companyId: string
    ): Promise<void> {
        try {
            const subscribers = await this.registry.getForCompany(companyId);
            if (subscribers.length === 0) return;

            const groups = new Map<
                string,
                { query: ListOrdersQueryDto; socketIds: string[] }
            >();

            for (const { socketId, query } of subscribers) {
                const cacheKey = this.ordersService.buildOrdersListCacheKey(
                    companyId,
                    query
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
                        await this.ordersService.invalidateOrdersListCache(
                            cacheKey
                        );
                        const result =
                            await this.ordersService.listOrdersForCompanyCached(
                                companyId,
                                query
                            );
                        for (const socketId of socketIds) {
                            this.emitter.emitToSocket(
                                socketId,
                                "order:update",
                                result
                            );
                        }
                    }
                )
            );
        } catch (err) {
            this.logger.error(
                `Failed to refresh subscribers for company ${companyId}`,
                (err as Error).stack
            );
        }
    }
}
