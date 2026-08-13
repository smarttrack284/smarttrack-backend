import {
    ConnectedSocket,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import { parse } from "cookie";
import { SupabaseJwtVerifierService } from "#/common/auth/supabase-jwt-verifier.service";
import { UsersService } from "#/modules/users/users.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { TeamRoleType } from "#/common/types/team-role.type";
import type { AuthenticatedSocket } from "#/common/types/authenticated-socket.type";
import { DriverPresenceService } from "./driver-presence.service";
import { HasActiveStopsService } from "./has-active-stops.service";
import { ConfigService } from "@nestjs/config";

type DriverSocket = AuthenticatedSocket & {
    data: {
        user?: any;
        companyId?: string;
        driverName?: string;
    };
};

@WebSocketGateway({
    namespace: "driver-presence",
    cors: { origin: process.env.CLIENT_URL ?? true, credentials: true }
})
export class DriverPresenceGateway implements OnGatewayInit {
    @WebSocketServer()
    server: Server;

    private readonly USER_ROLE_CACHE_TTL: number;
    private readonly logger = new Logger(DriverPresenceGateway.name);

    constructor(
        private readonly presenceService: DriverPresenceService,
        private readonly verifier: SupabaseJwtVerifierService,
        private readonly usersService: UsersService,
        private readonly hasActiveStopsService: HasActiveStopsService,
        private readonly cache: RedisCacheService,
        private readonly config: ConfigService
    ) {
        this.USER_ROLE_CACHE_TTL = this.config.get<number>(
            "USER_ROLE_CACHE_TTL",
            60
        );
    }

    afterInit(): void {}

    async handleConnection(socket: DriverSocket): Promise<void> {
        // Extract token from httpOnly cookie
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
            const user = await this.verifier.verify(token);

            // Enrich with cached user role
            const userId = user.id;
            const userRole = await this.cache.getOrSet<{
                companyId: string;
                role: string;
                name: string | null;
            } | null>(
                `user:company:${userId}`,
                this.USER_ROLE_CACHE_TTL,
                async () => {
                    const role =
                        await this.usersService.getUserRoleByUserId(userId);
                    return role
                        ? {
                              companyId: role.companyId,
                              role: role.role,
                              name: role.name
                          }
                        : null;
                }
            );

            if (!userRole || userRole.role !== TeamRoleType.DRIVER) {
                this.logger.warn(
                    `Socket ${socket.id} user ${userId} is not a driver – disconnecting`
                );
                socket.disconnect(true);
                return;
            }

            socket.data.user = user;
            socket.data.companyId = userRole.companyId;
            socket.data.driverName = userRole.name ?? user.email;

            await this.presenceService.setOnline(
                userRole.companyId,
                user.id,
                socket.data.driverName
            );
        } catch (err) {
            this.logger.error({
                msg: `Connection auth error for socket ${socket.id}`,
                stack: (err as Error).stack
            });
            socket.disconnect(true);
        }
    }

    handleDisconnect(socket: DriverSocket): void {
        if (!socket.data.user || !socket.data.companyId) return;

        this.presenceService.scheduleOffline(
            socket.data.companyId,
            socket.data.user.id,
            socket.data.driverName ?? socket.data.user.email,
            () => this.hasActiveStopsService.check(socket.data.user.id)
        );
    }

    @SubscribeMessage("heartbeat")
    async handleHeartbeat(@ConnectedSocket() socket: DriverSocket) {
        if (!socket.data.user || !socket.data.companyId) return;
        await this.presenceService.heartbeat(
            socket.data.companyId,
            socket.data.user.id
        );
    }
}
