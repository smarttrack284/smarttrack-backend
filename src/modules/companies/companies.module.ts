import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Company } from "#/common/entities/company.entity";
// import { NotificationSetting } from '#/common/entities/notification-setting.entity';
import { UsersModule } from "#/modules/users/users.module";
import { SubscriptionsModule } from "#/modules/subscriptions/subscriptions.module";
import { UsageModule } from "#/modules/usage/usage.module";
import { CompaniesService } from "./companies.service";
import { CompaniesController } from "./companies.controller";
import { SavedLocation } from "#/common/entities/saved-location.entity";
import { ApiKey } from "#/common/entities/api-key.entity";
import { CompanyNotificationSetting } from "#/common/entities/company-notification-settings.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Company,
          CompanyNotificationSetting,
            SavedLocation,
            ApiKey
        ]),
        UsersModule,
        SubscriptionsModule,
        UsageModule
    ],
    controllers: [CompaniesController],
    providers: [CompaniesService],
    exports: [CompaniesService]
})
export class CompaniesModule {}
