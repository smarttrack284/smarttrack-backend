import { Processor, WorkerHost } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { Repository } from "typeorm";
import { Subscription } from "#/common/entities/subscription.entity";
import { UserRole } from "#/common/entities/user-role.entity";
import { Company } from "#/common/entities/company.entity";
import { MailService } from "#/modules/mail/mail.service";
import { MailTemplate } from "#/modules/mail/interfaces/mail-template.interface";
import { TeamRoleType } from "#/common/types/team-role.type";
import {
    SubscriptionPlan,
    SubscriptionStatus
} from "#/common/constants/subscription-plan.constant";
import { format, isValid } from "date-fns";
import {
    SendExpirationRemindersJobData,
    SUBSCRIPTION_REMINDER_QUEUE_NAME,
    SubscriptionReminderJobName
} from "./constants/subscription-reminder-queue.constant";
import { ConfigService } from "@nestjs/config";
import { RedisCacheService } from "#/common/cache/redis-cache.service";

@Processor(SUBSCRIPTION_REMINDER_QUEUE_NAME, { concurrency: 5 })
export class SubscriptionReminderProcessor extends WorkerHost {
    private readonly logger = new Logger(SubscriptionReminderProcessor.name);

    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        private readonly mailService: MailService,
        private readonly config: ConfigService,
        private readonly cache: RedisCacheService
    ) {
        super();
    }

    async process(job: Job<SendExpirationRemindersJobData>): Promise<void> {
        if (job.name !== SubscriptionReminderJobName.SEND_EXPIRY_REMINDER) {
            this.logger.warn({
                msg: "Unknown job name received",
                jobName: job.name,
                jobId: job.id
            });
            return;
        }

        const { subscriptionId, companyId } = job.data;

        // Validate job payload
        if (!subscriptionId?.trim() || !companyId?.trim()) {
            this.logger.error({
                msg: "Invalid job payload: missing subscriptionId or companyId",
                jobId: job.id,
                subscriptionId,
                companyId
            });
            return; // Do not retry — payload is permanently bad
        }

        try {
            // Resolve subscription
            const subscription = await this.subscriptionRepo.findOne({
                where: { id: subscriptionId }
            });

            if (!subscription) {
                this.logger.warn({
                    msg: "Subscription not found for reminder",
                    subscriptionId,
                    companyId,
                    jobId: job.id
                });
                return;
            }

            // Only remind paid plans
            if (subscription.plan === SubscriptionPlan.FREE) {
                this.logger.log({
                    msg: "Skipping reminder: subscription is on FREE plan",
                    subscriptionId,
                    companyId
                });
                return;
            }

            // Only remind active subscriptions
            if (subscription.status !== SubscriptionStatus.ACTIVE) {
                this.logger.log({
                    msg: "Skipping reminder: subscription is not active",
                    subscriptionId,
                    companyId,
                    status: subscription.status
                });
                return;
            }

            // Idempotency: already sent recently?
            if (subscription.wasReminderRecentlySent?.()) {
                this.logger.log({
                    msg: "Skipping duplicate reminder: already sent recently",
                    subscriptionId,
                    companyId,
                    jobId: job.id
                });
                return;
            }

            // Idempotency: email already sent for this period?
            // Prevents duplicate emails if the job retries after save() fails
            const emailSentKey = `reminder-email:${subscriptionId}:${
                subscription.currentPeriodEnd?.toISOString().slice(0, 10) ??
                "none"
            }`;
            // If you have Redis injected, check it here:
            const alreadyEmailed = await this.cache.get(emailSentKey);
            if (alreadyEmailed) return;

            // Resolve owner
            const ownerRole = await this.userRoleRepo.findOne({
                where: { companyId, role: TeamRoleType.OWNER }
            });

            if (!ownerRole?.email) {
                this.logger.warn({
                    msg: "No owner email found for reminder",
                    subscriptionId,
                    companyId
                });
                return;
            }

            // Resolve company & format data
            const company = await this.companyRepo.findOne({
                where: { id: companyId }
            });

            const companyName = company?.name ?? "SmartTrack";
            const planName =
                subscription.plan === SubscriptionPlan.PRO ? "Pro" : "Starter";

            const periodEnd = subscription.currentPeriodEnd
                ? new Date(subscription.currentPeriodEnd)
                : null;
            const expiryDate =
                periodEnd && isValid(periodEnd)
                    ? format(periodEnd, "MMMM d, yyyy")
                    : "soon";

            const clientUrl = this.config.getOrThrow<string>("CLIENT_URL");
            const renewalUrl = `${clientUrl}/dashboard/billing`;
            const supportEmail =
                this.config.get<string>("SUPPORT_EMAIL") ??
                "help@smarttrack.com";

            // Send email
            await this.mailService.sendTemplateEmail({
                to: ownerRole.email,
                subject: `Your ${planName} plan expires on ${expiryDate}`,
                templateName: MailTemplate.SUBSCRIPTION_EXPIRING,
                context: {
                    companyName,
                    customerName: ownerRole.name ?? "there",
                    planName,
                    expiryDate,
                    renewalUrl,
                    supportEmail,
                    year: new Date().getFullYear()
                }
            });

            //  Mark reminder sent
            subscription.markReminderSent?.();
            await this.subscriptionRepo.save(subscription);

            //  Redis for email idempotency:
            await this.cache.set(emailSentKey, "1", 86400);

            this.logger.log({
                msg: "Expiry reminder sent successfully",
                subscriptionId,
                companyId,
                to: ownerRole.email,
                jobId: job.id
            });
        } catch (err) {
            this.logger.error({
                msg: "Failed to process expiry reminder job",
                jobId: job.id,
                subscriptionId,
                companyId,
                err: err instanceof Error ? err.message : String(err)
            });
            throw err; // BullMQ will retry based on queue config
        }
    }
}
