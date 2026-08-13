import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminCompaniesController } from "./companies.controller";
import { AdminCompaniesService } from "./companies.service";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { Company } from "#/common/entities/company.entity";
import { Subscription } from "#/common/entities/subscription.entity";
import { Usage } from "#/common/entities/usage.entity";
import { Order } from "#/common/entities/order.entity";
import { UserRole } from "#/common/entities/user-role.entity";
import { ApiKey } from "#/common/entities/api-key.entity";
import { WebhookEndpoint } from "#/common/entities/webhook-endpoint.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Company,
            Subscription,
            Usage,
            Order,
            UserRole,
            ApiKey,
            WebhookEndpoint
        ])
    ],
    controllers: [AdminCompaniesController],
    providers: [AdminCompaniesService, SuperAdminGuard]
})
export class AdminCompaniesModule {}
