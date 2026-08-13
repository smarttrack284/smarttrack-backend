import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { REQUIRE_PLAN_KEY } from "#/common/decorators/require-plan.decorator";
import {
    ForbiddenAppException,
    InternalErrorException,
    UnauthorizedAppException
} from "#/common/exceptions";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";

/**
 * Lean subscription shape for caching — avoids TypeORM circular references
 * and keeps the Redis payload small.
 */
export interface CachedSubscription {
    plan: string;
    status: string;
    currentPeriodEnd: Date | string | null;
    companyId: string;
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active"]);

@Injectable()
export class PlanGuard implements CanActivate {
    private readonly logger = new Logger(PlanGuard.name);
    public static SUBSCRIPTION_TTL = 60;
    constructor(
        private readonly reflector: Reflector,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly cache: RedisCacheService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredPlans = this.reflector.getAllAndOverride<string[]>(
            REQUIRE_PLAN_KEY,
            [context.getHandler(), context.getClass()]
        );

        if (!requiredPlans || requiredPlans.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest<FastifyRequest>();

        // The SupabaseAuthGuard has already validated the JWT and attached
        // the user object with companyId and role.
        const userId: string | undefined = request.user?.id;
        const companyId: string | null = request.user?.companyId ?? null;

        if (!userId || !companyId) {
            this.logger.warn(
                `PlanGuard: request.user missing id or companyId – was SupabaseAuthGuard applied?`
            );
            throw new UnauthorizedAppException(
                "Authentication required to access this resource"
            );
        }

        try {
            const subscription =
                await this.cache.getOrSet<CachedSubscription | null>(
                    PlanGuard.subscriptionKey(companyId),
                    PlanGuard.SUBSCRIPTION_TTL,
                    async () => {
                        const sub =
                            await this.subscriptionsService.getSubscriptionByCompanyId(
                                companyId
                            );
                        return sub ? this.toCachedSubscription(sub) : null;
                    }
                );

            if (!subscription) {
                this.logger.warn(
                    `PlanGuard: No subscription found for company ${companyId}`
                );
                throw new ForbiddenAppException(
                    "No active subscription found. Please contact your administrator."
                );
            }

            const currentPlan = subscription.plan?.toLowerCase()?.trim();
            if (!currentPlan) {
                this.logger.error(
                    `PlanGuard: Subscription for company ${companyId} has no plan`
                );
                throw new InternalErrorException(
                    "Subscription configuration error"
                );
            }

            const status = subscription.status?.toLowerCase();
            if (!status || !ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
                this.logger.warn(
                    `PlanGuard: Subscription status '${subscription.status}' not active for company ${companyId}`
                );
                throw new ForbiddenAppException(
                    "Your subscription is not active. Please renew to access this feature."
                );
            }

            const periodEnd = subscription.currentPeriodEnd;
            if (periodEnd && new Date() > new Date(periodEnd)) {
                this.logger.warn(
                    `PlanGuard: Subscription expired on ${periodEnd} for company ${companyId}`
                );
                throw new ForbiddenAppException(
                    "Your subscription has expired. Please renew to access this feature."
                );
            }

            const normalizedRequired = requiredPlans.map(p =>
                p.toLowerCase().trim()
            );
            if (!normalizedRequired.includes(currentPlan)) {
                this.logger.log(
                    `PlanGuard: Access denied – required [${normalizedRequired.join(
                        ", "
                    )}], actual ${currentPlan} for company ${companyId}`
                );
                throw new ForbiddenAppException(
                    "This feature is not available on your current plan. Please upgrade to access it."
                );
            }

            // Attach clean subscription context for downstream use
            request.subscription = {
                plan: currentPlan,
                status,
                companyId
            };

            return true;
        } catch (err) {
            if (
                err instanceof UnauthorizedAppException ||
                err instanceof ForbiddenAppException ||
                err instanceof InternalErrorException
            ) {
                throw err;
            }

            this.logger.error(
                `PlanGuard: Unexpected error for user ${userId} – ${
                    err instanceof Error ? err.message : String(err)
                }`,
                err instanceof Error ? err.stack : undefined
            );
            throw new InternalErrorException(
                "Unable to verify subscription status"
            );
        }
    }

    static subscriptionKey(companyId: string): string {
        return `plan-guard:subscription:${companyId}`;
    }

    private toCachedSubscription(sub: any): CachedSubscription {
        return {
            plan: sub.plan,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd ?? sub.expiresAt ?? null,
            companyId: sub.companyId
        };
    }
}
