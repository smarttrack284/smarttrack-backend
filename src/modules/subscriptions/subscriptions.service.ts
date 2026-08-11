import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
    DataSource,
    EntityManager,
    QueryFailedError,
    Repository
} from "typeorm";
import {
    PaymentProvider,
    Subscription
} from "#/common/entities/subscription.entity";
import {
    SUBSCRIPTION_PLAN_FEATURES,
    SubscriptionPlan,
    SubscriptionStatus
} from "#/common/constants/subscription-plan.constant";
import {
    InternalErrorException,
    ResourceConflictException,
    ResourceNotFoundException
} from "#/common/exceptions";
import {
    ErrorHandlerService,
    rule
} from "#/common/errors/error-handler.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { MailService } from "#/modules/mail/mail.service";
import { UserRole } from "#/common/entities/user-role.entity";
import { Company } from "#/common/entities/company.entity";
import { ConfigService } from "@nestjs/config";
import { MailTemplate } from "#/modules/mail/interfaces/mail-template.interface";

@Injectable()
export class SubscriptionsService {
    private readonly logger = new Logger(SubscriptionsService.name);

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,

        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        private readonly errorHandler: ErrorHandlerService,
        private readonly cache: RedisCacheService,
        private readonly config: ConfigService,
        private readonly mailService: MailService
    ) {}

    /**
     * Creates the initial subscription for a company.
     */
    async createSubscription(
        companyId: string,
        plan: SubscriptionPlan = SubscriptionPlan.FREE,
        manager?: EntityManager
    ): Promise<Subscription> {
        try {
            return this.withTransaction(manager, async trx => {
                const repo = trx.getRepository(Subscription);

                const existing = await repo.findOne({
                    where: { companyId }
                });

                if (existing) {
                    throw new ResourceConflictException(
                        "A subscription already exists for this company. Each company can only have one active subscription."
                    );
                }

                const subscription = repo.create({
                    companyId,
                    plan,
                    status: SubscriptionStatus.ACTIVE
                });

                const saved = await repo.save(subscription);
                // Invalidate the PlanGuard cache for this company
                await this.invalidatePlanGuardCache(companyId);
                return saved;
            });
        } catch (err) {
            this.errorHandler.handle(
                err,
                "SubscriptionsService.createSubscription",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to create subscription. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    /**
     * Retrieves the subscription associated with a company.
     */
    async getSubscriptionByCompanyId(
        companyId: string,
        manager?: EntityManager
    ): Promise<Subscription> {
        try {
            const repo = manager
                ? manager.getRepository(Subscription)
                : this.subscriptionRepo;

            const subscription = await repo.findOne({
                where: { companyId }
            });

            if (!subscription) {
                throw new ResourceNotFoundException(
                    "No subscription was found for this company."
                );
            }

            return subscription;
        } catch (err) {
            this.errorHandler.handle(
                err,
                "SubscriptionsService.getSubscriptionByCompanyId",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to retrieve subscription. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    getPlanLimits(plan: SubscriptionPlan): {
        orderLimit: number | null;
        teamMemberLimit: number | null;
    } {
        const features = SUBSCRIPTION_PLAN_FEATURES[plan];
        return {
            orderLimit: features.orderLimit,
            teamMemberLimit: features.teamMemberLimit
        };
    }

    /**
     * Updates a subscription from Paystack data (plan, status, period).
     * Uses `this.save` to guarantee cache invalidation.
     */
    async updateFromPaystackSubscription(input: {
        companyId: string;
        paystackCustomerCode: string;
        paystackSubscriptionCode: string;
        plan: SubscriptionPlan;
        status: SubscriptionStatus;
        currentPeriodEnd: Date;
    }): Promise<Subscription> {
        try {
            const subscription = await this.getSubscriptionByCompanyId(
                input.companyId
            );
            subscription.plan = input.plan;
            subscription.status = input.status;
            subscription.currentPeriodEnd = input.currentPeriodEnd;
            subscription.paymentProvider = PaymentProvider.PAYSTACK;
            subscription.paymentCustomerId = input.paystackCustomerCode;
            subscription.paymentSubscriptionId = input.paystackSubscriptionCode;
            subscription.lastExpiryReminderSentAt = null;
            // save() will invalidate cache
            return this.save(subscription);
        } catch (err) {
            this.errorHandler.handle(
                err,
                "SubscriptionsService.updateFromPaystackSubscription",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to update subscription. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    /**
     * Downgrades a subscription to FREE on cancellation.
     * Uses `this.save` for cache invalidation.
     */
    async downgradeToFreeOnCancellation(
        paystackSubscriptionCode: string
    ): Promise<void> {
        try {
            const subscription = await this.subscriptionRepo.findOne({
                where: { paymentSubscriptionId: paystackSubscriptionCode }
            });
            if (!subscription) return;

            subscription.plan = SubscriptionPlan.FREE;
            subscription.status = SubscriptionStatus.CANCELED;
            await this.save(subscription);
        } catch (err) {
            this.logger.error({
                msg: `Failed to downgrade subscription for Paystack code ${paystackSubscriptionCode}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            // Swallow – webhook handler expects no throw
        }
    }

    /**
     * Marks a subscription as PAST_DUE.
     * Uses `this.save` for cache invalidation.
     */
    async markPastDue(paystackSubscriptionCode: string): Promise<void> {
        try {
            const subscription = await this.subscriptionRepo.findOne({
                where: { paymentSubscriptionId: paystackSubscriptionCode }
            });
            if (!subscription) return;

            const wasAlreadyPastDue =
                subscription.status === SubscriptionStatus.PAST_DUE;

            subscription.status = SubscriptionStatus.PAST_DUE;
            await this.subscriptionRepo.save(subscription);

            // Invalidate cache
            await this.cache.del(
                `plan-guard:subscription:${subscription.companyId}`
            );

            // Send owner notification only the first time it becomes past due
            if (!wasAlreadyPastDue) {
                await this.sendPaymentFailedNotification(subscription);
            }
        } catch (err) {
            this.logger.error({
                msg: `Failed to mark subscription past due for Paystack code ${paystackSubscriptionCode}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    /**
     * Retrieves a subscription by Paystack customer code.
     */
    async getByPaystackCustomerCode(
        customerCode: string
    ): Promise<Subscription | null> {
        try {
            return await this.subscriptionRepo.findOne({
                where: { paymentCustomerId: customerCode }
            });
        } catch (err) {
            this.errorHandler.handle(
                err,
                "SubscriptionsService.getByPaystackCustomerCode",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to retrieve subscription. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    /**
     * Retrieves a subscription by Paystack subscription code.
     */
    async getByPaystackSubscriptionCode(
        subscriptionCode: string
    ): Promise<Subscription | null> {
        try {
            return await this.subscriptionRepo.findOne({
                where: { paymentSubscriptionId: subscriptionCode }
            });
        } catch (err) {
            this.logger.error({
                msg: `Failed to get subscription by Paystack code ${subscriptionCode}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            return null; // safe fallback
        }
    }

    /**
     * Saves a subscription and invalidates the PlanGuard cache.
     *
     * Every mutation that updates plan, status, or currentPeriodEnd must
     * use this method to ensure the guard never serves stale data.
     */
    async save(subscription: Subscription): Promise<Subscription> {
        const saved = await this.subscriptionRepo.save(subscription);
        await this.invalidatePlanGuardCache(saved.companyId);
        return saved;
    }

    /**
     * Deletes the PlanGuard cache entry for a company.
     * Uses the same key pattern defined in PlanGuard.
     */
    private async invalidatePlanGuardCache(companyId: string): Promise<void> {
        try {
            await this.cache.del(`plan-guard:subscription:${companyId}`);
        } catch (err) {
            this.logger.error({
                msg: `Failed to invalidate PlanGuard cache for company ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            // Non‑critical – cache will expire on its own in 60s
        }
    }

    private async sendPaymentFailedNotification(
        subscription: Subscription
    ): Promise<void> {
        try {
            // Find owner
            const ownerRole = await this.userRoleRepo.findOne({
                where: {
                    companyId: subscription.companyId,
                    role: TeamRoleType.OWNER
                }
            });
            if (!ownerRole?.email) return;

            // Fetch company name
            const company = await this.dataSource
                .getRepository(Company)
                .findOne({
                    where: { id: subscription.companyId }
                });
            const companyName = company?.name ?? "SmartTrack";

            const planName =
                subscription.plan === SubscriptionPlan.PRO ? "Pro" : "Starter";
            const renewalUrl = `${this.config.get(
                "CLIENT_URL"
            )}/dashboard/billing`;
            const supportEmail =
                this.config.get("SUPPORT_EMAIL") ?? "help@smarttrack.com";

            await this.mailService.sendTemplateEmail({
                to: ownerRole.email,
                subject: `Payment failed for your ${planName} plan`,
                templateName: MailTemplate.SUBSCRIPTION_PAYMENT_FAILED,
                context: {
                    companyName,
                    customerName: ownerRole.name ?? "there",
                    planName,
                    renewalUrl,
                    supportEmail,
                    year: new Date().getFullYear()
                }
            });
        } catch (err) {
            this.logger.error({
                msg: `Failed to send payment failed email for company ${subscription.companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
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
