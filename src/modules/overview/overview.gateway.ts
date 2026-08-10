import { Logger } from "@nestjs/common";
import {
    OnGatewayInit,
    WebSocketGateway,
    WebSocketServer
} from "@nestjs/websockets";
import type { Server } from "socket.io";
import { parse } from "cookie";
import { SupabaseJwtVerifierService } from "#/common/auth/supabase-jwt-verifier.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { UsersService } from "#/modules/users/users.service";
import type { AuthenticatedSocket } from "#/common/types/authenticated-socket.type";
import { OverviewEmitterService } from "./overview-emitter.service";
import { OverviewService } from "./overview.service";

const USER_ROLE_CACHE_TTL = 60;

@WebSocketGateway({
    namespace: "overview",
    cors: { origin: process.env.CLIENT_URL ?? true, credentials: true }
})
export class OverviewGateway implements OnGatewayInit {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(OverviewGateway.name);

    constructor(
        private readonly emitter: OverviewEmitterService,
        private readonly verifier: SupabaseJwtVerifierService,
        private readonly usersService: UsersService,
        private readonly overviewService: OverviewService,
        private readonly cache: RedisCacheService // new dependency
    ) {}

    afterInit(server: Server): void {
        this.emitter.setServer(server);
    }

    async handleConnection(socket: AuthenticatedSocket): Promise<void> {
        // Extract access token from the httpOnly cookie
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

            // 2. Enrich socket with companyId & role (cached, same as other gateways)
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

            // Store companyId on the socket for later use
            socket.data.user.companyId = userRole.companyId;
            socket.data.user.role = userRole.role;

            // Join the overview room and send an immediate snapshot
            await socket.join(`overview:${userRole.companyId}`);
            const [kpis, activity, recentOrders] = await Promise.all([
                this.overviewService.getKpis(userRole.companyId),
                this.overviewService.getRecentActivity(userRole.companyId),
                this.overviewService.getRecentOrders(userRole.companyId)
            ]);
            socket.emit("overview:update", { kpis, activity, recentOrders });
        } catch (err) {
            this.logger.error({ msg: 
                `Connection auth error for socket ${socket.id}`,
                err: (err as Error).message,
                stack: (err as Error).stack,
           } );
            socket.disconnect(true);
        }
    }
}
