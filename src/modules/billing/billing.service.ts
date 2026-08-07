import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import { Usage } from '#/common/entities/usage.entity';
import { SUBSCRIPTION_PLAN_FEATURES } from '#/common/constants/subscription-plan.constant';
import { SubscriptionsService } from '#/modules/subscriptions/subscriptions.service';
import { UsageService } from '#/modules/usage/usage.service';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { PaystackService } from '#/modules/subscriptions/paystack.service';
import { InternalErrorException } from '#/common/exceptions';
import { ErrorHandlerService, rule } from '#/common/errors/error-handler.service';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(Usage) private readonly usageRepo: Repository<Usage>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly usageService: UsageService,
    private readonly paystackService: PaystackService,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  async getBillingOverview(companyId: string) {
    try {
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
    } catch (err) {
      this.errorHandler.handle(err, 'BillingService.getBillingOverview', [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to load billing overview. Please try again.',
          ),
        ),
        rule(Error, () =>
          new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          ),
        ),
      ]);
    }
  }

  async changePlan(companyId: string, dto: UpdateSubscriptionPlanDto) {
    try {
      const subscription =
        await this.subscriptionsService.getSubscriptionByCompanyId(companyId);
      subscription.plan = dto.plan;
      return this.subscriptionRepo.save(subscription);
    } catch (err) {
      this.errorHandler.handle(err, 'BillingService.changePlan', [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to change plan. Please try again.',
          ),
        ),
        rule(Error, () =>
          new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          ),
        ),
      ]);
    }
  }

  async getBillingHistory(companyId: string, page: number, pageSize: number) {
    try {
      const subscription =
        await this.subscriptionsService.getSubscriptionByCompanyId(companyId);

      if (!subscription.paymentCustomerId) {
        return { transactions: [], total: 0, page, pageSize };
      }

      const { transactions, total } =
        await this.paystackService.listTransactionsForCustomer(
          subscription.paymentCustomerId,
          { page, perPage: pageSize },
        );

      return { transactions, total, page, pageSize };
    } catch (err) {
      this.errorHandler.handle(err, 'BillingService.getBillingHistory', [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to load billing history. Please try again.',
          ),
        ),
        rule(Error, () =>
          new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          ),
        ),
      ]);
    }
  }
}