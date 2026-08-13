// src/modules/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WebhookEndpoint } from '#/common/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '#/common/entities/webhook-delivery.entity';
import { UsersModule } from '#/modules/users/users.module';
import { SubscriptionsModule } from '#/modules/subscriptions/subscriptions.module';
import { WEBHOOK_QUEUE_NAME } from './constants/webhook-queue.constant';
import { WebhooksService } from './webhooks.service';
import { WebhooksDispatcherService } from './webhooks-dispatcher.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhooksController } from './webhooks.controller';
import { WebhookDeliveryCleanupService } from '#/modules/webhooks/webhook-delivery-cleanup.service';
import { UserRole } from '#/common/entities/user-role.entity';
import { PaystackWebhookController } from '#/modules/webhooks/paystack-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEndpoint, WebhookDelivery, UserRole]),
    BullModule.registerQueue({ name: WEBHOOK_QUEUE_NAME }),
    UsersModule,
    SubscriptionsModule,
  ],
  controllers: [WebhooksController, PaystackWebhookController],
  providers: [
    WebhooksService,
    WebhooksDispatcherService,
    WebhookDeliveryProcessor,
    WebhookDeliveryCleanupService,
  ],
})
export class WebhooksModule {}
