import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Usage } from "#/common/entities/usage.entity";
import { UsagesModule } from "#/modules/usages/usages.module";

@Module({
    imports: [TypeOrmModule.forFeature([Usage]), UsagesModule],
    controllers: [OrdersController],
    providers: [OrdersService]
})
export class OrdersModule {}
