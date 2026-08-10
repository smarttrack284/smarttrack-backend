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
import { SubscriptionStatus } from "#/common/constants/subscription-plan.constant";

@Injectable()
export class SubscriptionReminderService {
    private readonly logger = new Logger(SubscriptionReminderService.name);
    private static readonly REMINDER_DAYS_AHEAD = 3;

    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,
        @InjectQueue(SUBSCRIPTION_REMINDER_QUEUE_NAME)
        private readonly reminderQueue: Queue
    ) {}

    @Cron("0 8 * * *")
    async sendExpirationReminders(): Promise<void> {
        this.logger.log({ msg: "Running subscription expiration reminders…" });

        try {
            const now = new Date();
            const future = new Date();
            future.setDate(
                now.getDate() + SubscriptionReminderService.REMINDER_DAYS_AHEAD
            );

            // Only fetch the columns we need for the job data
            const subscriptions = await this.subscriptionRepo
                .createQueryBuilder("sub")
                .select(["sub.id", "sub.companyId"])
                .where("sub.status = :status", {
                    status: SubscriptionStatus.ACTIVE
                })
                .andWhere("sub.currentPeriodEnd BETWEEN :now AND :future", {
                    now,
                    future
                })
                .getMany();

            if (subscriptions.length === 0) {
                this.logger.log({ msg: "No subscriptions expiring soon." });
                return;
            }

            for (const sub of subscriptions) {
                // Use a unique jobId to prevent duplicate enqueuing if the cron runs multiple times
                const jobId = `reminder:${sub.id}`;
                await this.reminderQueue.add(
                    SubscriptionReminderJobName.SEND_EXPIRY_REMINDER,
                    {
                        subscriptionId: sub.id,
                        companyId: sub.companyId
                    },
                    {
                        jobId, // deduplication
                        attempts: 2,
                        backoff: { type: "exponential", delay: 5000 },
                        removeOnComplete: true,
                        removeOnFail: 500
                    }
                );
            }

            this.logger.log({
                msg: `Enqueued ${subscriptions.length} expiration reminders.`
            });
        } catch (err) {
            this.logger.error(
              {msg: 
                "Subscription reminder cron job failed",
              err:  (err as Error).message,
              stack:  (err as Error).stack,
           } );
        }
    }
}
