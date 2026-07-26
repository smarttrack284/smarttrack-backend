import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import {
  SUBSCRIPTION_PLAN_FEATURES,
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

  /**
   * Creates the initial subscription for a company.
   *
   * A company can only have one subscription. This method validates that no
   * subscription already exists before creating a new active subscription with
   * the specified plan.
   *
   * If a transaction manager is provided, the subscription is created within the
   * existing transaction; otherwise, a new transaction is started.
   *
   * @param companyId - The unique identifier of the company.
   * @param plan - The subscription plan to assign. Defaults to the Free plan.
   * @param manager - Optional transaction manager for participating in an existing transaction.
   *
   * @returns The newly created subscription.
   *
   * @throws {ResourceConflictException}
   * If the company already has a subscription.
   */
  async createSubscription(
    companyId: string,
    plan: SubscriptionPlan = SubscriptionPlan.FREE,
    manager?: EntityManager,
  ): Promise<Subscription> {
    return this.withTransaction(manager, async (trx) => {
      const repo = trx.getRepository(Subscription);

      const existing = await repo.findOne({
        where: { companyId },
      });

      if (existing) {
        throw new ResourceConflictException(
          'A subscription already exists for this company. Each company can only have one active subscription.',
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

  /**
   * Retrieves the subscription associated with a company.
   *
   * Looks up the company's subscription and optionally participates in an
   * existing transaction when a transaction manager is provided.
   *
   * @param companyId - The unique identifier of the company.
   * @param manager - Optional transaction manager for participating in an existing transaction.
   *
   * @returns The company's subscription.
   *
   * @throws {ResourceNotFoundException}
   * If no subscription exists for the specified company.
   */
  async getSubscriptionByCompanyId(
    companyId: string,
    manager?: EntityManager,
  ): Promise<Subscription> {
    const repo = manager
      ? manager.getRepository(Subscription)
      : this.subscriptionRepo;

    const subscription = await repo.findOne({
      where: { companyId },
    });

    if (!subscription) {
      throw new ResourceNotFoundException(
        'No subscription was found for this company.',
      );
    }

    return subscription;
  }

  getPlanLimits(plan: SubscriptionPlan): {
    orderLimit: number | null;
    teamMemberLimit: number | null;
  } {
    const features = SUBSCRIPTION_PLAN_FEATURES[plan];
    return {
      orderLimit: features.orderLimit,
      teamMemberLimit: features.teamMemberLimit,
    };
  }

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
}
