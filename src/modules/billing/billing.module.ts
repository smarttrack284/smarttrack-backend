import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '#/common/entities/subscription.entity';
import { Usage } from '#/common/entities/usage.entity';
import { SubscriptionsModule } from '#/modules/subscriptions/subscriptions.module';
import { UsageModule } from '#/modules/usage/usage.module';
import { UsersModule } from '#/modules/users/users.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { CompaniesModule } from '#/modules/companies/companies.module';
import { UserRole } from '#/common/entities/user-role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Usage,UserRole]),
    SubscriptionsModule,
    UsageModule,
    UsersModule,
    CompaniesModule,
  ],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
