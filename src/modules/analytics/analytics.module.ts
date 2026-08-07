import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '#/common/entities/order.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { Company } from '#/common/entities/company.entity';
import { UsersModule } from '#/modules/users/users.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { SubscriptionsModule } from '#/modules/subscriptions/subscriptions.module';
import { UserRole } from '#/common/entities/user-role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, TripStop, Company,UserRole]),
    UsersModule,
    SubscriptionsModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
