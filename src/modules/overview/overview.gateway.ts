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
import { ConfigService } from "@nestjs/config";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";

@WebSocketGateway({
    namespace: "overview",
    cors: { origin: process.env.CLIENT_URL ?? true, credentials: true }
})
export class OverviewGateway implements OnGatewayInit {
    private readonly USER_ROLE_CACHE_TTL: number;
    private readonly PLAN_CACHE_TTL: number;

    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(OverviewGateway.name);

    constructor(
        private readonly emitter: OverviewEmitterService,
        private readonly verifier: SupabaseJwtVerifierService,
        private readonly usersService: UsersService,
        private readonly overviewService: OverviewService,
        private readonly cache: RedisCacheService,
        private readonly config: ConfigService,
        private readonly subscriptionsService: SubscriptionsService
    ) {
        this.USER_ROLE_CACHE_TTL = this.config.get<number>(
            "USER_ROLE_CACHE_TTL",
            60
        );
        this.PLAN_CACHE_TTL = this.config.get<number>("PLAN_CACHE_TTL", 300);
    }

    afterInit(server: Server): void {
        this.emitter.setServer(server);
    }

    async handleConnection(socket: AuthenticatedSocket): Promise<void> {
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
            const payload = await this.verifier.verify(token);
            socket.data.user = payload;

            const userId: string = payload.id;
            const userRole = await this.cache.getOrSet<{
                companyId: string;
                role: string;
                status: string;
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

            socket.data.user.companyId = userRole.companyId;
            socket.data.user.role = userRole.role;

            // Determine subscription plan (cached)
            const plan = await this.cache.getOrSet<SubscriptionPlan>(
                `overview:plan:${userRole.companyId}`,
                this.PLAN_CACHE_TTL,
                async () => {
                    const sub =
                        await this.subscriptionsService.getSubscriptionByCompanyId(
                            userRole.companyId
                        );
                    return sub?.plan ?? SubscriptionPlan.FREE;
                }
            );

            await socket.join(`overview:${userRole.companyId}`);

            // Basic data always
            const [kpis, activity, recentOrders] = await Promise.all([
                this.overviewService.getKpis(userRole.companyId),
                this.overviewService.getRecentActivity(userRole.companyId),
                this.overviewService.getRecentOrders(userRole.companyId)
            ]);

            let payloadToSend: any = { kpis, activity, recentOrders };

            // Advanced data for Pro plan only
            if (plan === SubscriptionPlan.PRO) {
                const [advancedKpis, advancedRecentOrders, advancedActivity] =
                    await Promise.all([
                        this.overviewService.getAdvancedKpis(
                            userRole.companyId
                        ),
                        this.overviewService.getAdvancedRecentOrders(
                            userRole.companyId,
                            {
                                page: 1,
                                pageSize: 5
                            }
                        ),
                        this.overviewService.getAdvancedActivity(
                            userRole.companyId,
                            {
                                page: 1,
                                pageSize: 5
                            }
                        )
                    ]);

                payloadToSend = {
                    ...payloadToSend,
                    advanced: {
                        kpis: advancedKpis,
                        recentOrders: advancedRecentOrders,
                        activity: advancedActivity
                    }
                };
            }

            socket.emit("overview:update", payloadToSend);
        } catch (err) {
            this.logger.error({
                msg: `Connection auth error for socket ${socket.id}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            socket.disconnect(true);
        }
    }
}
