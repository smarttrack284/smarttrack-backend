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
import { TRIP_EVENTS, TripUpdatedEvent } from "#/common/events/trip.events";
import { DispatchService } from "./dispatch.service";
import { TripsEmitterService } from "./trips-emitter.service";
import { TripsSubscriptionRegistry } from "./trips-subscription-registry.service";
import { ListTripsQueryDto } from "./dto/list-trips.query.dto";
import { parse } from "cookie";

const DEBOUNCE_MS = 250;
const USER_ROLE_CACHE_TTL = 60;

@WebSocketGateway({
    namespace: "trips",
    cors: { origin: process.env.CLIENT_URL ?? true, credentials: true }
})
export class TripsGateway implements OnGatewayInit, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(TripsGateway.name);
    private readonly pendingRefresh = new Map<
        string,
        ReturnType<typeof setTimeout>
    >();

    constructor(
        private readonly emitter: TripsEmitterService,
        private readonly registry: TripsSubscriptionRegistry,
        private readonly verifier: SupabaseJwtVerifierService,
        private readonly usersService: UsersService,
        private readonly dispatchService: DispatchService,
        private readonly cache: RedisCacheService
    ) {}

    afterInit(server: Server): void {
        this.emitter.setServer(server);
    }

    async handleConnection(socket: AuthenticatedSocket): Promise<void> {
        // Extract access token from the httpOnly cookie sent with the upgrade request
        const rawCookie = socket.request.headers.cookie ?? "";
        const cookies = parse(rawCookie);
        const token = cookies["sb-access-token"];

        if (!token) {
            this.logger.warn({
                msg: `Socket ${socket.id} missing access token – disconnecting`
            });
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
                this.logger.warn({
                    msg: `Socket ${socket.id} user ${userId} has no active company role`
                });
                socket.disconnect(true);
                return;
            }

            // Enrich socket data with companyId
            socket.data.user.companyId = userRole.companyId;
            // Also store role if needed (optional)
            socket.data.user.role = userRole.role;
        } catch (err) {
            this.logger.error({
                msg: `Connection auth error for socket ${socket.id}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            socket.disconnect(true);
        }
    }

    async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
        try {
            await this.registry.remove(socket.id);
        } catch (err) {
            this.logger.error({
                msg: `Failed to remove subscription on disconnect for socket ${socket.id}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    @SubscribeMessage("subscribe:trips")
    async handleSubscribe(
        @ConnectedSocket() socket: AuthenticatedSocket,
        @MessageBody() query: ListTripsQueryDto
    ) {
        const companyId = socket.data.user.companyId;
        if (!companyId) {
            socket.emit("error", { message: "Authentication required" });
            return;
        }

        try {
            await this.registry.set(socket.id, companyId, query);

            const result =
                await this.dispatchService.listTripsForCompanyWithDriverNames(
                    companyId,
                    query
                );
            socket.emit("trips:update", result);
        } catch (err) {
            this.logger.error({
                msg: `Failed to subscribe socket ${socket.id} for company ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            socket.emit("error", {
                message:
                    "Failed to subscribe to trip updates. Please try again."
            });
        }
    }

    @SubscribeMessage("unsubscribe:trips")
    async handleUnsubscribe(@ConnectedSocket() socket: AuthenticatedSocket) {
        try {
            await this.registry.remove(socket.id);
        } catch (err) {
            this.logger.error({
                msg: `Failed to unsubscribe socket ${socket.id}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
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

    private async refreshSubscribersForCompany(
        companyId: string
    ): Promise<void> {
        try {
            const subscribers = await this.registry.getForCompany(companyId);
            if (subscribers.length === 0) return;

            const groups = new Map<
                string,
                { query: ListTripsQueryDto; socketIds: string[] }
            >();
            for (const { socketId, query } of subscribers) {
                const key = JSON.stringify(query);
                const group = groups.get(key);
                if (group) group.socketIds.push(socketId);
                else groups.set(key, { query, socketIds: [socketId] });
            }

            await Promise.all(
                Array.from(groups.values()).map(
                    async ({ query, socketIds }) => {
                        const result =
                            await this.dispatchService.listTripsForCompanyWithDriverNames(
                                companyId,
                                query
                            );
                        for (const socketId of socketIds) {
                            this.emitter.emitToSocket(
                                socketId,
                                "trips:update",
                                result
                            );
                        }
                    }
                )
            );
        } catch (err) {
            this.logger.error({
                msg: `Failed to refresh subscribers for company ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }
}
