import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import { Usage } from '#/common/entities/usage.entity';
import { SUBSCRIPTION_PLAN_LIMITS } from '#/common/constants/subscription-plan.constant';
import { SubscriptionsService } from '#/modules/subscriptions/subscriptions.service';
import { UsageService } from '#/modules/usage/usage.service';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

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
  ) {}

  /** Mirrors the frontend's BillingData shape: plan info + live usage together, since the plan card needs both to render its usage bar. */
  async getBillingOverview(companyId: string) {
    const subscription =
      await this.subscriptionsService.getSubscriptionByCompanyId(companyId);
    const usage = await this.usageRepo.findOne({ where: { companyId } });
    const limits = SUBSCRIPTION_PLAN_LIMITS[subscription.plan];

    return {
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      paymentProvider: subscription.paymentProvider,
      paymentCustomerId: subscription.paymentCustomerId,
      usage: {
        ordersThisPeriod: usage?.ordersThisPeriod ?? 0,
        orderLimit: limits.orderLimit,
        teamMembersCount: usage?.teamMembersCount ?? 0,
        teamMemberLimit: limits.teamMemberLimit,
      },
    };
  }

  /**
   * Changes the plan on the LOCAL record only — this is deliberately NOT
   * where a real payment actually happens. A genuine plan upgrade/
   * downgrade needs to go through your payment provider's checkout/portal
   * flow (Stripe Checkout, Paystack, etc.), and the LOCAL subscription
   * record should be updated by a WEBHOOK confirming that payment
   * succeeded — not by this endpoint trusting a client's request that
   * they've paid. This method exists for: (a) the FREE plan, which has no
   * payment step at all, and (b) as the method a future webhook handler
   * calls once it has confirmed payment out-of-band. Exposing this
   * directly to end users for STARTER/PRO would let anyone grant
   * themselves a paid plan for free.
   */
  async changePlan(companyId: string, dto: UpdateSubscriptionPlanDto) {
    const subscription =
      await this.subscriptionsService.getSubscriptionByCompanyId(companyId);
    subscription.plan = dto.plan;
    return this.subscriptionRepo.save(subscription);
  }
}
