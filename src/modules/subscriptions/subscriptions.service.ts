import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import {
  PlanLimits,
  SUBSCRIPTION_PLAN_LIMITS,
  SubscriptionPlan,
  SubscriptionStatus,
} from '#/common/constants/subscription-plan.constant';
import {
  ResourceConflictException,
  ResourceNotFoundException,
} from '#/common/exceptions';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  private async withTransaction<T>(
    manager: EntityManager | undefined,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (manager) return work(manager);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Every company gets a subscription at creation time — defaults to
   * FREE. Called from CompaniesService.createCompany inside the same
   * transaction as the company row itself.
   */
  async createSubscription(
    companyId: string,
    plan: SubscriptionPlan = SubscriptionPlan.FREE,
    manager?: EntityManager,
  ): Promise<Subscription> {
    return this.withTransaction(manager, async (trx) => {
      const repo = trx.getRepository(Subscription);
      const existing = await repo.findOne({ where: { companyId } });
      if (existing) {
        throw new ResourceConflictException(
          'This company already has a subscription',
        );
      }
      const subscription = repo.create({
        companyId,
        plan,
        status: SubscriptionStatus.ACTIVE,
      });
      return repo.save(subscription);
    });
  }

  async getSubscriptionByCompanyId(
    companyId: string,
    manager?: EntityManager,
  ): Promise<Subscription> {
    const repo = manager
      ? manager.getRepository(Subscription)
      : this.subscriptionRepo;
    const subscription = await repo.findOne({ where: { companyId } });
    if (!subscription) {
      throw new ResourceNotFoundException('Subscription');
    }
    return subscription;
  }

  getPlanLimits(plan: SubscriptionPlan): PlanLimits {
    return SUBSCRIPTION_PLAN_LIMITS[plan];
  }
}
