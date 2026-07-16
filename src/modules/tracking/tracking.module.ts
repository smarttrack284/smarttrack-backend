import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trip } from '#/common/entities/trip.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { Order } from '#/common/entities/order.entity';
import { UsersModule } from '#/modules/users/users.module';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { TrackingEmitterService } from './tracking-emitter.service';
import { TrackingController } from './tracking.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Trip, TripStop, Order]), UsersModule],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingGateway, TrackingEmitterService],
  exports: [TrackingService],
})
export class TrackingModule {}
