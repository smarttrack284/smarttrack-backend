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
    BadRequestAppException,
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
import { TeamRoleType } from "#/common/types/team-role.type";
import { PlanGuard } from "#/common/guards/plan.guard";

@Injectable()
export class SubscriptionsService {
    private readonly logger = new Logger(SubscriptionsService.name);
    private readonly PROCESSED_TXN_TTL = 86400; // 24 hours

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

    /* ------------------------------------------------------------------ */
    /*  createSubscription                                                 */
    /* ------------------------------------------------------------------ */

    async createSubscription(
        companyId: string,
        plan: SubscriptionPlan = SubscriptionPlan.FREE,
        manager?: EntityManager
    ): Promise<Subscription> {
        if (!companyId?.trim()) {
            throw new BadRequestAppException("Company ID is required.");
        }

        try {
            return await this.withTransaction(manager, async trx => {
                const repo = trx.getRepository(Subscription);

                const existing = await repo.findOne({ where: { companyId } });

                if (existing) {
                    throw new ResourceConflictException(
                        "A subscription already exists for this company."
                    );
                }

                const subscription = repo.create({
                    companyId,
                    plan,
                    status: SubscriptionStatus.ACTIVE
                });

                const saved = await repo.save(subscription);
                await this.invalidatePlanGuardCache(companyId);
                return saved;
            });
        } catch (err) {
            if (
                err instanceof BadRequestAppException ||
                err instanceof ResourceConflictException
            ) {
                throw err;
            }

            this.logger.error({
                msg: "Failed to create subscription",
                companyId,
                plan,
                err: err instanceof Error ? err.message : String(err)
            });

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
                    )
                ]
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  getSubscriptionByCompanyId                                         */
    /* ------------------------------------------------------------------ */

    async getSubscriptionByCompanyId(
        companyId: string,
        manager?: EntityManager
    ): Promise<Subscription> {
        if (!companyId?.trim()) {
            throw new BadRequestAppException("Company ID is required.");
        }

        try {
            const repo = manager
                ? manager.getRepository(Subscription)
                : this.subscriptionRepo;

            const subscription = await repo.findOne({ where: { companyId } });

            if (!subscription) {
                throw new ResourceNotFoundException(
                    "No subscription was found for this company."
                );
            }

            return subscription;
        } catch (err) {
            if (
                err instanceof BadRequestAppException ||
                err instanceof ResourceNotFoundException
            ) {
                throw err;
            }

            this.logger.error({
                msg: "Failed to get subscription by company ID",
                companyId,
                err: err instanceof Error ? err.message : String(err)
            });

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
                    )
                ]
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  getPlanLimits                                                      */
    /* ------------------------------------------------------------------ */

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

    /* ------------------------------------------------------------------ */
    /*  updateFromPaystackSubscription                                     */
    /* ------------------------------------------------------------------ */

    async updateFromPaystackSubscription(input: {
        companyId: string;
        paystackCustomerCode: string;
        paystackSubscriptionCode: string;
        plan: SubscriptionPlan;
        status: SubscriptionStatus;
        currentPeriodEnd: Date | null;
    }): Promise<Subscription> {
        if (!input.companyId?.trim()) {
            throw new BadRequestAppException("Company ID is required.");
        }
        if (!input.paystackSubscriptionCode?.trim()) {
            throw new BadRequestAppException(
                "Paystack subscription code is required."
            );
        }

        try {
            // Find existing subscription (should exist as FREE from onboarding)
            let subscription = await this.subscriptionRepo.findOne({
                where: { companyId: input.companyId }
            });

            if (!subscription) {
                // Defensive: create if missing (webhook safety against race conditions)
                this.logger.warn({
                    msg: "Subscription not found during Paystack update, creating new record",
                    companyId: input.companyId
                });
                subscription = this.subscriptionRepo.create({
                    companyId: input.companyId,
                    plan: input.plan,
                    status: input.status,
                    currentPeriodEnd: input.currentPeriodEnd,
                    paymentProvider: PaymentProvider.PAYSTACK,
                    paymentCustomerId: input.paystackCustomerCode,
                    paymentSubscriptionId: input.paystackSubscriptionCode
                });
            } else {
                subscription.plan = input.plan;
                subscription.status = input.status;
                subscription.currentPeriodEnd = input.currentPeriodEnd;
                subscription.paymentProvider = PaymentProvider.PAYSTACK;
                subscription.paymentCustomerId = input.paystackCustomerCode;
                subscription.paymentSubscriptionId =
                    input.paystackSubscriptionCode;
                subscription.lastExpiryReminderSentAt = null;
            }

            return await this.save(subscription);
        } catch (err) {
            if (err instanceof BadRequestAppException) {
                throw err;
            }

            this.logger.error({
                msg: "Failed to update subscription from Paystack",
                companyId: input.companyId,
                subscriptionCode: input.paystackSubscriptionCode,
                err: err instanceof Error ? err.message : String(err)
            });

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
                    )
                ]
            );
        }
    }

    /* ------------------------------------------------------------------ */
    /*  downgradeToFreeOnCancellation                                      */
    /* ------------------------------------------------------------------ */

    async downgradeToFreeOnCancellation(
        paystackSubscriptionCode: string
    ): Promise<void> {
        if (!paystackSubscriptionCode?.trim()) {
            this.logger.warn({
                msg: "downgradeToFreeOnCancellation called with empty code"
            });
            return;
        }

        try {
            const subscription = await this.subscriptionRepo.findOne({
                where: { paymentSubscriptionId: paystackSubscriptionCode }
            });
            if (!subscription) {
                this.logger.warn({
                    msg: "Subscription not found for downgrade",
                    paystackSubscriptionCode
                });
                return;
            }

            // Idempotency
            if (
                subscription.plan === SubscriptionPlan.FREE &&
                subscription.status === SubscriptionStatus.CANCELED
            ) {
                return;
            }

            subscription.plan = SubscriptionPlan.FREE;
            subscription.status = SubscriptionStatus.CANCELED;
            subscription.cancelAtPeriodEnd = false;
            await this.save(subscription);

            this.logger.log({
                msg: "Subscription downgraded to FREE on cancellation",
                companyId: subscription.companyId,
                paystackSubscriptionCode
            });
        } catch (err) {
            this.logger.error({
                msg: "Failed to downgrade subscription",
                paystackSubscriptionCode,
                err: err instanceof Error ? err.message : String(err)
            });
            // Swallow – webhook handler expects no throw
        }
    }

    /* ------------------------------------------------------------------ */
    /*  markPastDue                                                        */
    /* ------------------------------------------------------------------ */

    async markPastDue(paystackSubscriptionCode: string): Promise<void> {
        if (!paystackSubscriptionCode?.trim()) {
            this.logger.warn({
                msg: "markPastDue called with empty code"
            });
            return;
        }

        try {
            const subscription = await this.subscriptionRepo.findOne({
                where: { paymentSubscriptionId: paystackSubscriptionCode }
            });
            if (!subscription) {
                this.logger.warn({
                    msg: "Subscription not found for past_due marking",
                    paystackSubscriptionCode
                });
                return;
            }

            // Idempotency
            if (subscription.status === SubscriptionStatus.PAST_DUE) {
                return;
            }

            subscription.status = SubscriptionStatus.PAST_DUE;
            await this.save(subscription);

            await this.sendPaymentFailedNotification(subscription);

            this.logger.log({
                msg: "Subscription marked as past due",
                companyId: subscription.companyId,
                paystackSubscriptionCode
            });
        } catch (err) {
            this.logger.error({
                msg: "Failed to mark subscription past due",
                paystackSubscriptionCode,
                err: err instanceof Error ? err.message : String(err)
            });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  getByPaystackCustomerCode                                          */
    /* ------------------------------------------------------------------ */

    async getByPaystackCustomerCode(
        customerCode: string
    ): Promise<Subscription | null> {
        if (!customerCode?.trim()) {
            return null;
        }

        try {
            return await this.subscriptionRepo.findOne({
                where: { paymentCustomerId: customerCode }
            });
        } catch (err) {
            this.logger.error({
                msg: "Failed to get subscription by customer code",
                customerCode,
                err: err instanceof Error ? err.message : String(err)
            });
            return null;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  getByPaystackSubscriptionCode                                      */
    /* ------------------------------------------------------------------ */

    async getByPaystackSubscriptionCode(
        subscriptionCode: string
    ): Promise<Subscription | null> {
        if (!subscriptionCode?.trim()) {
            return null;
        }

        try {
            return await this.subscriptionRepo.findOne({
                where: { paymentSubscriptionId: subscriptionCode }
            });
        } catch (err) {
            this.logger.error({
                msg: "Failed to get subscription by subscription code",
                subscriptionCode,
                err: err instanceof Error ? err.message : String(err)
            });
            return null;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  save                                                               */
    /* ------------------------------------------------------------------ */

    async save(subscription: Subscription): Promise<Subscription> {
        const saved = await this.subscriptionRepo.save(subscription);
        await this.invalidatePlanGuardCache(saved.companyId);
        return saved;
    }

    /* ------------------------------------------------------------------ */
    /*  Idempotency (webhook safety)                                       */
    /* ------------------------------------------------------------------ */

    async isTransactionProcessed(reference: string): Promise<boolean> {
        if (!reference) return false;
        try {
            const key = `paystack:processed-txn:${reference}`;
            const exists = await this.cache.get(key);
            return exists === "1";
        } catch (err) {
            this.logger.error({
                msg: "Failed to check transaction idempotency",
                reference,
                err: err instanceof Error ? err.message : String(err)
            });
            return false; // allow processing on cache failure (safe side)
        }
    }

    async markTransactionProcessed(reference: string): Promise<void> {
        if (!reference) return;
        try {
            const key = `paystack:processed-txn:${reference}`;
            await this.cache.set(key, "1", this.PROCESSED_TXN_TTL);
        } catch (err) {
            this.logger.error({
                msg: "Failed to mark transaction as processed",
                reference,
                err: err instanceof Error ? err.message : String(err)
            });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Private helpers                                                    */
    /* ------------------------------------------------------------------ */

    private async invalidatePlanGuardCache(companyId: string): Promise<void> {
        try {
            await this.cache.del(PlanGuard.subscriptionKey(companyId));
        } catch (err) {
            this.logger.error({
                msg: "Failed to invalidate PlanGuard cache",
                companyId,
                err: err instanceof Error ? err.message : String(err)
            });
        }
    }

    private async sendPaymentFailedNotification(
        subscription: Subscription
    ): Promise<void> {
        try {
            const ownerRole = await this.userRoleRepo.findOne({
                where: {
                    companyId: subscription.companyId,
                    role: TeamRoleType.OWNER
                }
            });
            if (!ownerRole?.email) return;

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
                msg: "Failed to send payment failed notification",
                companyId: subscription.companyId,
                err: err instanceof Error ? err.message : String(err)
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
