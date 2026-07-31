import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import { Usage } from '#/common/entities/usage.entity';
import { SUBSCRIPTION_PLAN_FEATURES } from '#/common/constants/subscription-plan.constant';
import { SubscriptionsService } from '#/modules/subscriptions/subscriptions.service';
import { UsageService } from '#/modules/usage/usage.service';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { PaystackService } from '#/modules/subscriptions/paystack.service';

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
    private readonly usageService: UsageService,
    private readonly paystackService: PaystackService,
  ) {}

  async getBillingOverview(companyId: string) {
    const subscription =
      await this.subscriptionsService.getSubscriptionByCompanyId(companyId);
    const usage = await this.usageRepo.findOne({ where: { companyId } });
    const features = SUBSCRIPTION_PLAN_FEATURES[subscription.plan];

    return {
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      usage: {
        ordersThisPeriod: usage?.ordersThisPeriod ?? 0,
        orderLimit: features.orderLimit,
        teamMembersCount: usage?.teamMembersCount ?? 0,
        teamMemberLimit: features.teamMemberLimit,
      },
    };
  }

  async changePlan(companyId: string, dto: UpdateSubscriptionPlanDto) {
    const subscription =
      await this.subscriptionsService.getSubscriptionByCompanyId(companyId);
    subscription.plan = dto.plan;
    return this.subscriptionRepo.save(subscription);
  }

  async getBillingHistory(companyId: string, page: number, pageSize: number) {
    const subscription =
      await this.subscriptionsService.getSubscriptionByCompanyId(companyId);

    if (!subscription.paymentCustomerId) {
      // Never been through checkout — genuinely nothing to show, not an error.
      return { transactions: [], total: 0, page, pageSize };
    }

    const { transactions, total } =
      await this.paystackService.listTransactionsForCustomer(
        subscription.paymentCustomerId,
        { page, perPage: pageSize },
      );

    return { transactions, total, page, pageSize };
  }
}
