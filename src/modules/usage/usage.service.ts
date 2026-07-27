import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Usage } from '#/common/entities/usage.entity';
import { SubscriptionsService } from '#/modules/subscriptions/subscriptions.service';
import {
  PlanLimitExceededException,
  ResourceConflictException,
  ResourceNotFoundException,
  UnprocessableEntityException,
} from '#/common/exceptions';

@Injectable()
export class UsageService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(Usage) private readonly usageRepo: Repository<Usage>,
        private readonly subscriptionsService: SubscriptionsService
    ) {}

    /**
     * Creates the initial usage record for a company.
     *
     * Initializes usage tracking for the current billing period, including the
     * starting team member count and order usage. A company can only have one
     * usage record.
     *
     * If a transaction manager is provided, the operation participates in the
     * existing transaction; otherwise, a new transaction is started.
     *
     * @param companyId - The unique identifier of the company.
     * @param initialTeamMembers - The initial number of team members. Defaults to `1`.
     * @param manager - Optional transaction manager for participating in an existing transaction.
     *
     * @returns The newly created usage record.
     *
     * @throws {ResourceConflictException}
     * If usage tracking has already been initialized for the company.
     */
    async createUsage(
        companyId: string,
        initialTeamMembers = 1,
        manager?: EntityManager
    ): Promise<Usage> {
        return this.withTransaction(manager, async trx => {
            const repo = trx.getRepository(Usage);

            const existing = await repo.findOne({
                where: { companyId }
            });

            if (existing) {
                throw new ResourceConflictException(
                    "Usage tracking has already been initialized for this company."
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
                periodEnd
            });

            return repo.save(usage);
        });
    }

    /**
     * Retrieves the usage record for a company.
     *
     * Looks up the company's usage information for the current billing period.
     * If a transaction manager is provided, the lookup is performed within the
     * existing transaction; otherwise, the default repository is used.
     *
     * @param companyId - The unique identifier of the company.
     * @param manager - Optional transaction manager for participating in an existing transaction.
     *
     * @returns The company's usage record.
     *
     * @throws {ResourceNotFoundException}
     * If no usage record exists for the specified company.
     */
    async getUsage(companyId: string, manager?: EntityManager): Promise<Usage> {
        const repo = manager ? manager.getRepository(Usage) : this.usageRepo;

        const usage = await repo.findOne({
            where: { companyId }
        });

        if (!usage) {
            throw new ResourceNotFoundException(
                "No usage record was found for this company."
            );
        }

        return usage;
    }

    /**
     * Increments the order usage count for a company.
     *
     * Increases the number of orders created during the current billing period
     * while ensuring the company has not exceeded the order limit defined by its
     * subscription plan.
     *
     * A pessimistic write lock is used to prevent race conditions when multiple
     * orders are created simultaneously for the same company.
     *
     * If a transaction manager is provided, the update participates in the existing
     * transaction; otherwise, a new transaction is started.
     *
     * @param companyId - The unique identifier of the company.
     * @param manager - Optional transaction manager for participating in an existing transaction.
     *
     * @returns The updated usage record.
     *
     * @throws {ResourceNotFoundException}
     * If no usage record exists for the company.
     *
     * @throws {UnprocessableEntityException}
     * If the company has reached the order limit allowed by its subscription plan.
     */
    async incrementOrderCount(
        companyId: string,
        manager?: EntityManager
    ): Promise<Usage> {
        return this.withTransaction(manager, async trx => {
            const usageRepo = trx.getRepository(Usage);

            const usage = await usageRepo.findOne({
                where: { companyId },
                lock: { mode: "pessimistic_write" }
            });

            if (!usage) {
                throw new ResourceNotFoundException(
                    "No usage record was found for this company."
                );
            }

            const subscription =
              await this.subscriptionsService.getSubscriptionByCompanyId(
                companyId,
                trx,
              );

            const limits = this.subscriptionsService.getPlanLimits(
              subscription.plan,
            );

          if (limits.orderLimit !== null && usage.ordersThisPeriod + 1 > limits.orderLimit) {
            throw new PlanLimitExceededException('orders', limits.orderLimit);
          }

            usage.ordersThisPeriod += 1;

            return usageRepo.save(usage);
        });
    }

    /**
     * Increments the team member usage count for a company.
     *
     * Increases the number of team members currently associated with the company
     * while ensuring the company has not exceeded the team member limit defined by
     * its subscription plan.
     *
     * A pessimistic write lock is used to prevent race conditions when multiple
     * invitations or member additions occur simultaneously.
     *
     * If a transaction manager is provided, the update participates in the existing
     * transaction; otherwise, a new transaction is started.
     *
     * @param companyId - The unique identifier of the company.
     * @param manager - Optional transaction manager for participating in an existing transaction.
     *
     * @returns The updated usage record.
     *
     * @throws {ResourceNotFoundException}
     * If no usage record exists for the company.
     *
     * @throws {UnprocessableEntityException}
     * If the company has reached the maximum team member limit allowed by its plan.
     */
    async incrementTeamMemberCount(
        companyId: string,
        manager?: EntityManager
    ): Promise<Usage> {
        return this.withTransaction(manager, async trx => {
            const usageRepo = trx.getRepository(Usage);

            const usage = await usageRepo.findOne({
                where: { companyId },
                lock: { mode: "pessimistic_write" }
            });

            if (!usage) {
                throw new ResourceNotFoundException(
                    "No usage record was found for this company."
                );
            }

            const subscription =
                await this.subscriptionsService.getSubscriptionByCompanyId(
                    companyId,
                    trx
                );

            const limits = this.subscriptionsService.getPlanLimits(
                subscription.plan
            );

          if (
            limits.teamMemberLimit !== null &&
            usage.teamMembersCount + 1 > limits.teamMemberLimit
          ) {
            throw new PlanLimitExceededException(
              'team_members',
              limits.teamMemberLimit,
            );
          }

            usage.teamMembersCount += 1;

            return usageRepo.save(usage);
        });
    }

    /**
     * Decrements the team member usage count for a company.
     *
     * Reduces the number of team members currently associated with the company
     * when a member is removed or an invitation is cancelled.
     *
     * A pessimistic write lock is used to prevent race conditions when multiple
     * team member updates occur simultaneously.
     *
     * The team member count will never go below zero.
     *
     * If a transaction manager is provided, the update participates in the existing
     * transaction; otherwise, a new transaction is started.
     *
     * @param companyId - The unique identifier of the company.
     * @param manager - Optional transaction manager for participating in an existing transaction.
     *
     * @returns The updated usage record.
     *
     * @throws {ResourceNotFoundException}
     * If no usage record exists for the company.
     */
    async decrementTeamMemberCount(
        companyId: string,
        manager?: EntityManager
    ): Promise<Usage> {
        return this.withTransaction(manager, async trx => {
            const usageRepo = trx.getRepository(Usage);

            const usage = await usageRepo.findOne({
                where: { companyId },
                lock: { mode: "pessimistic_write" }
            });

            if (!usage) {
                throw new ResourceNotFoundException(
                    "No usage record was found for this company."
                );
            }

            usage.teamMembersCount = Math.max(0, usage.teamMembersCount - 1);

            return usageRepo.save(usage);
        });
    }

    /**
     * Decrements the order usage count for a company.
     *
     * Reduces the number of orders counted within the current billing period.
     * This is typically used when an order is deleted, cancelled, or otherwise
     * removed from usage calculations.
     *
     * A pessimistic write lock is used to prevent race conditions when multiple
     * order usage updates occur simultaneously.
     *
     * The order count will never go below zero.
     *
     * If a transaction manager is provided, the update participates in the existing
     * transaction; otherwise, a new transaction is started.
     *
     * @param companyId - The unique identifier of the company.
     * @param manager - Optional transaction manager for participating in an existing transaction.
     *
     * @returns The updated usage record.
     *
     * @throws {ResourceNotFoundException}
     * If no usage record exists for the company.
     */
    async decrementOrderCount(
        companyId: string,
        manager?: EntityManager
    ): Promise<Usage> {
        return this.withTransaction(manager, async trx => {
            const usageRepo = trx.getRepository(Usage);

            const usage = await usageRepo.findOne({
                where: { companyId },
                lock: { mode: "pessimistic_write" }
            });

            if (!usage) {
                throw new ResourceNotFoundException(
                    "No usage record was found for this company."
                );
            }

            usage.ordersThisPeriod = Math.max(0, usage.ordersThisPeriod - 1);

            return usageRepo.save(usage);
        });
    }

    private async withTransaction<T>(
        manager: EntityManager | undefined,
        work: (manager: EntityManager) => Promise<T>
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
