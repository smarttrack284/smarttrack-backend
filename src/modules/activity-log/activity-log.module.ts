import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLog } from '#/common/entities/activity-log.entity';
import { ActivityLogService } from './activity-log.service';
import { SubscriptionsModule } from '#/modules/subscriptions/subscriptions.module';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog]), SubscriptionsModule],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
