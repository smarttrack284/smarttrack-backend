import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usage } from '#/common/entities/usage.entity';
import { SubscriptionsModule } from '#/modules/subscriptions/subscriptions.module';
import { UsageService } from './usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([Usage]), SubscriptionsModule],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
