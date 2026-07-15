import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Usage } from '#/common/entities/usage.entity';
import { SubscriptionsService } from '#/modules/subscriptions/subscriptions.service';
import {
  ResourceConflictException,
  ResourceNotFoundException,
  UnprocessableEntityException,
} from '#/common/exceptions';

@Injectable()
export class UsageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Usage) private readonly usageRepo: Repository<Usage>,
    private readonly subscriptionsService: SubscriptionsService,
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

  /** Called once, at company creation, alongside the subscription row. `initialTeamMembers` counts the owner being created in the same flow. */
  async createUsage(
    companyId: string,
    initialTeamMembers = 1,
    manager?: EntityManager,
  ): Promise<Usage> {
    return this.withTransaction(manager, async (trx) => {
      const repo = trx.getRepository(Usage);
      const existing = await repo.findOne({ where: { companyId } });
      if (existing) {
        throw new ResourceConflictException(
          'Usage tracking already exists for this company',
        );
      }

      const periodStart = new Date();
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const usage = repo.create({
        companyId,
        ordersThisPeriod: 0,
        teamMembersCount: initialTeamMembers,
        periodStart,
        periodEnd,
      });
      return repo.save(usage);
    });
  }

  async getUsage(companyId: string, manager?: EntityManager): Promise<Usage> {
    const repo = manager ? manager.getRepository(Usage) : this.usageRepo;
    const usage = await repo.findOne({ where: { companyId } });
    if (!usage) {
      throw new ResourceNotFoundException('Usage');
    }
    return usage;
  }

  /**
   * Increments the order count and enforces the company's plan limit.
   * Uses a pessimistic row lock so two concurrent order-creation requests
   * can't both read the same pre-increment count and both pass the limit
   * check — the second request waits for the first's transaction to
   * commit, then sees the updated count.
   *
   * Call this from OrdersService inside the SAME transaction as the order
   * insert, passing that transaction's manager — incrementing usage but
   * then having the actual order creation fail would leave the count
   * wrong.
   */
  async incrementOrderCount(
    companyId: string,
    manager?: EntityManager,
  ): Promise<Usage> {
    return this.withTransaction(manager, async (trx) => {
      const usage = await trx.getRepository(Usage).findOne({
        where: { companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!usage) {
        throw new ResourceNotFoundException('Usage');
      }

      const subscription =
        await this.subscriptionsService.getSubscriptionByCompanyId(
          companyId,
          trx,
        );
      const limits = this.subscriptionsService.getPlanLimits(subscription.plan);

      if (
        limits.orderLimit !== null &&
        usage.ordersThisPeriod + 1 > limits.orderLimit
      ) {
        throw new UnprocessableEntityException(
          `This workspace has reached its plan's limit of ${limits.orderLimit} orders this period. Upgrade to create more.`,
        );
      }

      usage.ordersThisPeriod += 1;
      return trx.getRepository(Usage).save(usage);
    });
  }

  /** Same locking/limit-check shape as incrementOrderCount — call when a team invite is accepted. */
  async incrementTeamMemberCount(
    companyId: string,
    manager?: EntityManager,
  ): Promise<Usage> {
    return this.withTransaction(manager, async (trx) => {
      const usage = await trx.getRepository(Usage).findOne({
        where: { companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!usage) {
        throw new ResourceNotFoundException('Usage');
      }

      const subscription =
        await this.subscriptionsService.getSubscriptionByCompanyId(
          companyId,
          trx,
        );
      const limits = this.subscriptionsService.getPlanLimits(subscription.plan);

      if (
        limits.teamMemberLimit !== null &&
        usage.teamMembersCount + 1 > limits.teamMemberLimit
      ) {
        throw new UnprocessableEntityException(
          `This workspace has reached its plan's limit of ${limits.teamMemberLimit} team members. Upgrade to invite more.`,
        );
      }

      usage.teamMembersCount += 1;
      return trx.getRepository(Usage).save(usage);
    });
  }

  /** Call when a team member is removed — no limit check needed, only ever decreasing. */
  async decrementTeamMemberCount(
    companyId: string,
    manager?: EntityManager,
  ): Promise<Usage> {
    return this.withTransaction(manager, async (trx) => {
      const usage = await trx.getRepository(Usage).findOne({
        where: { companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!usage) {
        throw new ResourceNotFoundException('Usage');
      }
      usage.teamMembersCount = Math.max(0, usage.teamMembersCount - 1);
      return trx.getRepository(Usage).save(usage);
    });
  }
  
  /** Call when an order is deleted — the inverse of incrementOrderCount. No limit check needed, only ever decreasing. */
async decrementOrderCount(companyId: string, manager?: EntityManager): Promise<Usage> {
  return this.withTransaction(manager, async (trx) => {
    const usage = await trx.getRepository(Usage).findOne({
      where: { companyId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!usage) {
      throw new ResourceNotFoundException('Usage');
    }
    usage.ordersThisPeriod = Math.max(0, usage.ordersThisPeriod - 1);
    return trx.getRepository(Usage).save(usage);
  });
}
}
