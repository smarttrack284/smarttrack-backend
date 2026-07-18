import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Order } from "#/common/entities/order.entity";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { Company } from "#/common/entities/company.entity";
import { UsersModule } from "#/modules/users/users.module";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsController } from "./analytics.controller";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, TripStop, Company]),
        UsersModule
    ],
    controllers: [AnalyticsController],
    providers: [AnalyticsService]
})
export class AnalyticsModule {}
