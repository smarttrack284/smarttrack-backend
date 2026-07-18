import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Order } from "#/common/entities/order.entity";
import { OrderItem } from "#/common/entities/order-item.entity";
import { UsageModule } from "#/modules/usage/usage.module";
import { UsersModule } from "#/modules/users/users.module";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { OrdersEmitterService } from "./orders-emitter.service";
import { OrdersSubscriptionRegistry } from "./orders-subscription-registry.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, OrderItem]),
        UsageModule,
        UsersModule
    ],
    controllers: [OrdersController],
    providers: [OrdersService,OrdersEmitterService,OrdersSubscriptionRegistry],
    exports: [OrdersService]
})
export class OrdersModule {}
