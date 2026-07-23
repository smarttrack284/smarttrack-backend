import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Subscription } from "#/common/entities/subscription.entity";
import { Usage } from "#/common/entities/usage.entity";
import { SUBSCRIPTION_PLAN_LIMITS } from "#/common/constants/subscription-plan.constant";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { UsageService } from "#/modules/usage/usage.service";
import { UpdateSubscriptionPlanDto } from "./dto/update-subscription-plan.dto";

/**
 * Matches the frontend's BillingSection exactly: current plan + usage
 * (BillingPlanCard), payment method (BillingPaymentMethodCard), invoice
 * history (BillingHistoryTable), and a change-plan flow
 * (ChangePlanDialog). Deliberately does NOT talk to a payment provider
 * directly here — see the constructor comment.
 */
@Injectable()
export class BillingService {
    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,
        @InjectRepository(Usage) private readonly usageRepo: Repository<Usage>,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly usageService: UsageService
    ) {}

    async getBillingOverview(companyId: string) {
        const subscription =
            await this.subscriptionsService.getSubscriptionByCompanyId(
                companyId
            );
        const usage = await this.usageRepo.findOne({ where: { companyId } });
        const limits = SUBSCRIPTION_PLAN_LIMITS[subscription.plan];

        return {
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            usage: {
                ordersThisPeriod: usage?.ordersThisPeriod ?? 0,
                orderLimit: limits.orderLimit,
                teamMembersCount: usage?.teamMembersCount ?? 0,
                teamMemberLimit: limits.teamMemberLimit
            }
        };
    }

    async changePlan(companyId: string, dto: UpdateSubscriptionPlanDto) {
        const subscription =
            await this.subscriptionsService.getSubscriptionByCompanyId(
                companyId
            );
        subscription.plan = dto.plan;
        return this.subscriptionRepo.save(subscription);
    }
}
