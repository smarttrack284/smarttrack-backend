import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Subscription } from "#/common/entities/subscription.entity";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
    SUBSCRIPTION_REMINDER_QUEUE_NAME,
    SubscriptionReminderJobName
} from "./constants/subscription-reminder-queue.constant";
import {
    SubscriptionPlan,
    SubscriptionStatus
} from "#/common/constants/subscription-plan.constant";

@Injectable()
export class SubscriptionReminderService {
    private readonly logger = new Logger(SubscriptionReminderService.name);
    private readonly reminderDaysAhead: number;

    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,
        @InjectQueue(SUBSCRIPTION_REMINDER_QUEUE_NAME)
        private readonly reminderQueue: Queue,
        private readonly config: ConfigService
    ) {
        this.reminderDaysAhead =
            this.config.get<number>("SUBSCRIPTION_REMINDER_DAYS_AHEAD") ?? 3;
    }

    @Cron("0 8 * * *")
    async sendExpirationReminders(): Promise<void> {
        this.logger.log({ msg: "Running subscription expiration reminders…" });

        try {
            const now = new Date();
            now.setMilliseconds(0);

            const future = new Date(now);
            future.setDate(now.getDate() + this.reminderDaysAhead);

            // Only paid plans that are active and have a known expiration date
            const subscriptions = await this.subscriptionRepo
                .createQueryBuilder("sub")
                .select(["sub.id", "sub.companyId", "sub.currentPeriodEnd"])
                .where("sub.status = :status", {
                    status: SubscriptionStatus.ACTIVE
                })
                .andWhere("sub.plan != :freePlan", {
                    freePlan: SubscriptionPlan.FREE
                })
                .andWhere("sub.currentPeriodEnd IS NOT NULL")
                .andWhere("sub.currentPeriodEnd BETWEEN :now AND :future", {
                    now,
                    future
                })
                .getMany();

            if (subscriptions.length === 0) {
                this.logger.log({
                    msg: "No paid subscriptions expiring soon."
                });
                return;
            }

            let enqueued = 0;
            let skipped = 0;

            for (const sub of subscriptions) {
                // Guard: currentPeriodEnd should be populated (TypeORM partial entity safety)
                if (!sub.currentPeriodEnd) {
                    skipped++;
                    continue;
                }

                // Unique jobId per billing period — prevents a stale failed job
                // from blocking reminders after the subscription renews.
                const periodDate = new Date(sub.currentPeriodEnd)
                    .toISOString()
                    .slice(0, 10);
                const jobId = `reminder:${sub.id}:${periodDate}`;

                try {
                    await this.reminderQueue.add(
                        SubscriptionReminderJobName.SEND_EXPIRY_REMINDER,
                        {
                            subscriptionId: sub.id,
                            companyId: sub.companyId
                        },
                        {
                            jobId,
                            attempts: 3,
                            backoff: { type: "exponential", delay: 10_000 },
                            removeOnComplete: { count: 100 },
                            removeOnFail: { count: 50 }
                        }
                    );
                    enqueued++;
                } catch (enqueueErr) {
                    this.logger.error({
                        msg: "Failed to enqueue reminder job",
                        subscriptionId: sub.id,
                        companyId: sub.companyId,
                        jobId,
                        err:
                            enqueueErr instanceof Error
                                ? enqueueErr.message
                                : String(enqueueErr)
                    });
                    skipped++;
                }
            }

            this.logger.log({
                msg: "Expiration reminder enqueue completed",
                totalFound: subscriptions.length,
                enqueued,
                skipped,
                windowStart: now.toISOString(),
                windowEnd: future.toISOString()
            });
        } catch (err) {
            this.logger.error({
                msg: "Subscription reminder cron job failed",
                err: err instanceof Error ? err.message : String(err)
            });
        }
    }
}
