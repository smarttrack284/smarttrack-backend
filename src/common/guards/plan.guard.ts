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
    InternalErrorException,
    UnauthorizedAppException
} from "#/common/exceptions";
import { UsersService } from "#/modules/users/users.service";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";

/**
 * Lean subscription shape for caching — avoids TypeORM circular JSON
 * references and keeps Redis payload small.
 */
interface CachedSubscription {
    plan: string;
    status: string;
    currentPeriodEnd: Date | string | null;
    companyId: string;
}

/**
 * Subscription states that grant feature access.
 * 'trialing' is included because trial users typically have full
 * feature access until the trial ends.
 */
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active"]);

@Injectable()
export class PlanGuard implements CanActivate {
    private readonly logger = new Logger(PlanGuard.name);

    // Short TTLs by design: auth data should be fresh, but we still
    // want to absorb burst traffic on gated endpoints.
    private readonly USER_ROLE_TTL = 60; // seconds
    private readonly SUBSCRIPTION_TTL = 60; // seconds

    constructor(
        private readonly reflector: Reflector,
        private readonly usersService: UsersService,
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

        if (!request.user?.id) {
            throw new UnauthorizedAppException("Missing authenticated user");
        }

        try {
            const companyId = await this.resolveCompanyId(request.user);

            if (!companyId) {
                this.logger.warn(
                    `PlanGuard: User ${request.user.id} has no company association`
                );
                throw new UnauthorizedAppException(
                    "User is not associated with a company"
                );
            }

            const subscription =
                await this.cache.getOrSet<CachedSubscription | null>(
                    PlanGuard.subscriptionKey(companyId),
                    this.SUBSCRIPTION_TTL,
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
                throw new UnauthorizedAppException(
                    "No active subscription found"
                );
            }

            const currentPlan = subscription.plan?.toLowerCase()?.trim();
            if (!currentPlan) {
                this.logger.error(
                    `PlanGuard: Subscription for company ${companyId} has no plan assigned`
                );
                throw new InternalErrorException(
                    "Subscription configuration error"
                );
            }

            const status = subscription.status?.toLowerCase();
            if (!status || !ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
                this.logger.warn(
                    `PlanGuard: Subscription for company ${companyId} is not active (status: ${subscription.status})`
                );
                throw new UnauthorizedAppException(
                    "Your subscription is not active. Please renew to access this feature."
                );
            }

            const periodEnd = subscription.currentPeriodEnd;
            if (periodEnd && new Date() > new Date(periodEnd)) {
                this.logger.warn(
                    `PlanGuard: Subscription for company ${companyId} expired on ${periodEnd}`
                );
                throw new UnauthorizedAppException(
                    "Your subscription has expired. Please renew to access this feature."
                );
            }

            const normalizedRequired = requiredPlans.map(p =>
                p.toLowerCase().trim()
            );

            if (!normalizedRequired.includes(currentPlan)) {
                this.logger.log(
                    `PlanGuard: Access denied for company ${companyId}. ` +
                        `Required: [${normalizedRequired.join(
                            ", "
                        )}], Actual: ${currentPlan}`
                );
                throw new UnauthorizedAppException(
                    "This feature is not available on your current plan. Please upgrade to access it."
                );
            }

            // Attach clean subscription context for downstream use
            request.subscription = { plan: currentPlan, status, companyId };

            return true;
        } catch (err) {
            if (err instanceof UnauthorizedAppException) {
                throw err;
            }

            this.logger.error(
                `PlanGuard: Unexpected error for user ${request.user.id} - ${
                    err instanceof Error ? err.message : String(err)
                }`,
                err instanceof Error ? err.stack : undefined
            );
            throw new InternalErrorException(
                "Unable to verify subscription status"
            );
        }
    }

    /**
     * Public cache-key helpers so your webhook / billing handlers can
     * invalidate immediately when a subscription changes.
     *
     * Example usage in a Stripe webhook controller:
     *   await cache.del(PlanGuard.subscriptionKey(companyId));
     */
    static subscriptionKey(companyId: string): string {
        return `plan-guard:subscription:${companyId}`;
    }

    static userRoleKey(userId: string): string {
        return `plan-guard:user-role:${userId}`;
    }

    /**
     * Resolves companyId with the least I/O possible:
     * 1. JWT payload (zero I/O — ideal)
     * 2. Redis cache (1 RTT)
     * 3. Users table (fallback, then cached)
     */
    private async resolveCompanyId(
        user: AuthenticatedUser
    ): Promise<string | null> {
        return this.cache.getOrSet<string | null>(
            PlanGuard.userRoleKey(user.id),
            this.USER_ROLE_TTL,
            async () => {
                const userRole = await this.usersService.getUserRoleByUserId(
                    user.id
                );
                return userRole?.companyId ?? null;
            }
        );
    }

    /**
     * Strip TypeORM metadata / circular refs before caching.
     * Only persist the fields the guard actually needs.
     */
    private toCachedSubscription(sub: any): CachedSubscription {
        return {
            plan: sub.plan,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd ?? sub.expiresAt ?? null,
            companyId: sub.companyId
        };
    }
}
