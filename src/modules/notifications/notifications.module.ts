import { Module, Global } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { CustomerNotificationsService } from "./customer-notifications.service";
import { TeamNotificationsService } from "./team-notifications.service";
import { CompanyNotificationSetting } from "#/common/entities/company-notification-settings.entity";
import { NotificationSetting } from "#/common/entities/notification-setting.entity";
import { TypeOrmModule } from "@nestjs/typeorm";
@Global()
@Module({
    imports: [TypeOrmModule.forFeature([CompanyNotificationSetting,
    NotificationSetting])],
    controllers: [NotificationsController],
    providers: [
        NotificationsService,
        CustomerNotificationsService,
        TeamNotificationsService
    ],
    exports: [NotificationsService]
})
export class NotificationsModule {}
