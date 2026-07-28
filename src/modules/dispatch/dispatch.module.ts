import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trip } from '#/common/entities/trip.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { OrdersModule } from '#/modules/orders/orders.module';
import { UsersModule } from '#/modules/users/users.module';
import { DispatchService } from './dispatch.service';
import { DispatchController } from './dispatch.controller';
import { TrackingModule } from '#/modules/tracking/tracking.module';
import { TripsGateway } from '#/modules/dispatch/trips.gateway';
import { TripsEmitterService } from '#/modules/dispatch/trips-emitter.service';
import { TripsSubscriptionRegistry } from '#/modules/dispatch/trips-subscription-registry.service';
import { UserRole } from '#/common/entities/user-role.entity';
import { ApiKey } from '#/common/entities/api-key.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trip, TripStop, UserRole,ApiKey]),
    OrdersModule,
    UsersModule,
    forwardRef(() => TrackingModule),
  ],
  controllers: [DispatchController],
  providers: [
    DispatchService,
    TripsGateway,
    TripsEmitterService,
    TripsSubscriptionRegistry,
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
