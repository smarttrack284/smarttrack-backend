import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';
import { PaystackService } from '#/modules/subscriptions/paystack.service';
import { PaystackWebhookHandlerService } from '#/modules/subscriptions/paystack-webhook-handler.service';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription])],
  providers: [
    SubscriptionsService,
    PaystackService,
    PaystackWebhookHandlerService,
  ],
  exports: [
    SubscriptionsService,
    PaystackService,
    PaystackWebhookHandlerService,
  ],
})
export class SubscriptionsModule {}
