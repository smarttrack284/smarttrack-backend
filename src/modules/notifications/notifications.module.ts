import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { CustomerNotificationsService } from './customer-notifications.service';
import { TeamNotificationsService } from './team-notifications.service';
import { CompanyNotificationSetting } from '#/common/entities/company-notification-settings.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '#/common/entities/company.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([CompanyNotificationSetting, Company])],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    CustomerNotificationsService,
    TeamNotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
