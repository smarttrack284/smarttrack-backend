import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Trip } from '#/common/entities/trip.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { Order } from '#/common/entities/order.entity';
import { UsersModule } from '#/modules/users/users.module';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { TrackingEmitterService } from './tracking-emitter.service';
import { TrackingController } from './tracking.controller';
import { TrackingBroadcastProcessor } from './tracking-broadcast.processor';
import { RadarEtaService } from './radar-eta.service';
import { RadarRateLimiter } from './radar-rate-limiter.service';
import { TRACKING_QUEUE_NAME } from './constants/tracking-queue.constant';
import { DispatchModule } from '#/modules/dispatch/dispatch.module';
import { PresenceModule } from '#/modules/presence/presence.module';
import { UserRole } from '#/common/entities/user-role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trip, TripStop, Order, UserRole]),
    UsersModule,
    forwardRef(() => DispatchModule),
    BullModule.registerQueue({ name: TRACKING_QUEUE_NAME }),
    PresenceModule,
  ],
  controllers: [TrackingController],
  providers: [
    TrackingService,
    TrackingGateway,
    TrackingEmitterService,
    TrackingBroadcastProcessor,
    RadarEtaService,
    RadarRateLimiter,
  ],
  exports: [TrackingService],
})
export class TrackingModule {}
