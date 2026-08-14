import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Company } from "#/common/entities/company.entity";
import { Subscription } from "#/common/entities/subscription.entity";
import { UserRole } from "#/common/entities/user-role.entity";
import { Order } from "#/common/entities/order.entity";
import { AdminDashboardController } from "./dashboard.controller";
import { AdminDashboardService } from "./dashboard.service";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";

@Module({
    imports: [
        TypeOrmModule.forFeature([Company, Subscription, UserRole, Order])
    ],
    controllers: [AdminDashboardController],
    providers: [AdminDashboardService, AdminAuthGuard]
})
export class AdminDashboardModule {}
