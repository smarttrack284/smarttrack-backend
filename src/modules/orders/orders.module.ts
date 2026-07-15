import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '#/common/entities/order.entity';
import { OrderItem } from '#/common/entities/order-item.entity';
import { UsageModule } from '#/modules/usage/usage.module';
import { UsersModule } from '#/modules/users/users.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem]),
    UsageModule,
    UsersModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
