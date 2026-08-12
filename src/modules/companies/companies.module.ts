import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Company } from "#/common/entities/company.entity";
import { UsersModule } from "#/modules/users/users.module";
import { SubscriptionsModule } from "#/modules/subscriptions/subscriptions.module";
import { UsageModule } from "#/modules/usage/usage.module";
import { CompaniesService } from "./companies.service";
import { CompaniesController } from "./companies.controller";
import { SavedLocation } from "#/common/entities/saved-location.entity";
import { ApiKey } from "#/common/entities/api-key.entity";
import { Order } from "#/common/entities/order.entity";
import { CompanyNotificationSetting } from "#/common/entities/company-notification-settings.entity";
import { UserRole } from "#/common/entities/user-role.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Company,
            CompanyNotificationSetting,
            SavedLocation,
            ApiKey,
            UserRole,
            Order
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
