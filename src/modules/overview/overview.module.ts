import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '#/common/entities/order.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { Company } from '#/common/entities/company.entity';
import { OrdersModule } from '#/modules/orders/orders.module';
import { UsersModule } from '#/modules/users/users.module';
import { OverviewService } from './overview.service';
import { OverviewGateway } from './overview.gateway';
import { OverviewEmitterService } from './overview-emitter.service';
import { OverviewController } from './overview.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, TripStop, Company]),
    OrdersModule,
    UsersModule,
  ],
  controllers: [OverviewController],
  providers: [OverviewService, OverviewGateway, OverviewEmitterService],
})
export class OverviewModule {}
