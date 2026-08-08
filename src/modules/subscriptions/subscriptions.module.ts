import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';
import { PaystackService } from '#/modules/subscriptions/paystack.service';
import { PaystackWebhookHandlerService } from '#/modules/subscriptions/paystack-webhook-handler.service';
import { BullModule } from '@nestjs/bullmq';
import { SUBSCRIPTION_REMINDER_QUEUE_NAME } from './constants/subscription-reminder-queue.constant';
import { SubscriptionReminderService } from './subscription-reminder.service';
import { SubscriptionReminderProcessor } from './subscription-reminder.processor';
import { Company } from '#/common/entities/company.entity';
import { UserRole } from '#/common/entities/user-role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Company, UserRole]),
    BullModule.registerQueue({
      name: SUBSCRIPTION_REMINDER_QUEUE_NAME,
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 500 },
    }),
  ],
  providers: [
    SubscriptionsService,
    PaystackService,
    PaystackWebhookHandlerService,
    SubscriptionReminderService,
    SubscriptionReminderProcessor,
  ],
  exports: [
    SubscriptionsService,
    PaystackService,
    PaystackWebhookHandlerService,
  ],
})
export class SubscriptionsModule {}
