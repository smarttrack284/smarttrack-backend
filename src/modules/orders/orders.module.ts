import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Order } from "#/common/entities/order.entity";
import { OrderItem } from "#/common/entities/order-item.entity";
import { UsageModule } from "#/modules/usage/usage.module";
import { UsersModule } from "#/modules/users/users.module";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { OrdersExternalController } from "./orders-external.controller";
import { OrdersEmitterService } from "./orders-emitter.service";
import { OrdersSubscriptionRegistry } from "./orders-subscription-registry.service";
import { OrdersGateway } from "#/modules/orders/orders.gateway";
import { UserRole } from "#/common/entities/user-role.entity";
import { TeamModule } from "#/modules/team/team.module";
import { CompaniesModule } from "#/modules/companies/companies.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, OrderItem, UserRole]),
        UsageModule,
        UsersModule,
        TeamModule,
        CompaniesModule
    ],
    controllers: [OrdersController,OrdersExternalController],
    providers: [
        OrdersService,
        OrdersEmitterService,
        OrdersSubscriptionRegistry,
        OrdersGateway
    ],
    exports: [OrdersService]
})
export class OrdersModule {}
