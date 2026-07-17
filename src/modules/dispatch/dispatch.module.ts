import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trip } from '#/common/entities/trip.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { OrdersModule } from '#/modules/orders/orders.module';
import { UsersModule } from '#/modules/users/users.module';
import { DispatchService } from './dispatch.service';
import { DispatchController } from './dispatch.controller';
import { TrackingModule } from '#/modules/tracking/tracking.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trip, TripStop]),
    OrdersModule,
    UsersModule,
    TrackingModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
