import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

// import { StripeService } from '#/modules/subscriptions/stripe.service';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription])],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
