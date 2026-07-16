import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trip } from '#/common/entities/trip.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { Order } from '#/common/entities/order.entity';
import { ForbiddenAppException, ResourceNotFoundException, } from '#/common/exceptions';
import { deriveTripStatus, getCurrentStop, getTripProgress, } from '#/common/utils/trip-status.util';
import { UsersService } from '#/modules/users/users.service';
import { TrackingEmitterService } from './tracking-emitter.service';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';

@Injectable()
export class TrackingService {
  constructor(
    @InjectRepository(Trip) private readonly tripRepo: Repository<Trip>,
    @InjectRepository(TripStop)
    private readonly tripStopRepo: Repository<TripStop>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    private readonly usersService: UsersService,
    private readonly emitter: TrackingEmitterService,
  ) {}

  /** Only the driver actually assigned to this trip can post location for it. */
  async updateDriverLocation(
    tripId: string,
    driverUserId: string,
    dto: UpdateDriverLocationDto,
  ): Promise<void> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new ResourceNotFoundException('Trip', tripId);
    if (trip.driverUserId !== driverUserId) {
      throw new ForbiddenAppException(
        'You are not the driver assigned to this trip',
      );
    }

    trip.driverLocationLat = dto.lat;
    trip.driverLocationLng = dto.lng;
    trip.driverLocationUpdatedAt = new Date();
    await this.tripRepo.save(trip);

    await this.broadcastTripUpdate(tripId);
  }

  /**
   * Rebuilds and re-broadcasts a trip's current state to both audiences.
   * Called after a location update AND after any stop-status change
   * (DispatchService calls this too, via TrackingService, after
   * arrive/complete/skip) — so both rooms always reflect the latest truth
   * regardless of which kind of change triggered it.
   */
  async broadcastTripUpdate(tripId: string): Promise<void> {
    const trip = await this.tripRepo.findOne({
      where: { id: tripId },
      relations: { stops: { order: { items: true } } },
    });
    if (!trip) return;
    trip.stops.sort((a, b) => a.sequence - b.sequence);

    this.emitter.emitToInternalRoom(
      tripId,
      'trip:update',
      this.toInternalPayload(trip),
    );

    for (const stop of trip.stops) {
      this.emitter.emitToPublicRoom(
        stop.order.trackingNumber,
        'tracking:update',
        this.toPublicPayload(trip, stop),
      );
    }
  }

  /** Full detail — only ever emitted to trip:{id}:internal, which requires verified company membership to join. */
  toInternalPayload(trip: Trip) {
    return {
      id: trip.id,
      driverUserId: trip.driverUserId,
      status: deriveTripStatus(trip.stops),
      progress: getTripProgress(trip.stops),
      currentStop: getCurrentStop(trip.stops),
      driverLocation: trip.driverLocationLat
        ? {
            lat: trip.driverLocationLat,
            lng: trip.driverLocationLng,
            updatedAt: trip.driverLocationUpdatedAt,
          }
        : null,
      stops: trip.stops.map((stop) => ({
        id: stop.id,
        sequence: stop.sequence,
        orderId: stop.orderId,
        trackingNumber: stop.order.trackingNumber,
        orderReference: stop.order.orderReference,
        customerName: stop.order.customerName,
        customerPhone: stop.order.customerPhone,
        pickupLocation: stop.order.pickupLocation,
        dropoffLocation: stop.order.dropoffLocation,
        priority: stop.order.priority,
        status: stop.status,
        arrivedAt: stop.arrivedAt,
        completedAt: stop.completedAt,
        skipReason: stop.skipReason,
        skipNote: stop.skipNote,
      })),
    };
  }

  /** Used by the gateway when a socket first subscribes to the internal room — verifies company membership before allowing the join. */
  async assertUserCanAccessTrip(userId: string, tripId: string): Promise<void> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new ResourceNotFoundException('Trip', tripId);

    const userRole = await this.usersService.getUserRoleByUserId(userId);
    if (userRole.companyId !== trip.companyId) {
      throw new ForbiddenAppException(
        'This trip does not belong to your company',
      );
    }
  }

  /** Resolves a tracking number to its current trip + stop for the public "get initial snapshot" path — the tracking number itself is the only credential a public client ever presents. */
  async getPublicSnapshotByTrackingNumber(trackingNumber: string) {
    const order = await this.orderRepo.findOne({ where: { trackingNumber } });
    if (!order) throw new ResourceNotFoundException('Order');

    const stop = await this.tripStopRepo.findOne({
      where: { orderId: order.id },
      relations: { trip: true, order: true },
    });
    if (!stop) {
      // Order exists but hasn't been dispatched onto a trip yet.
      return {
        trackingNumber,
        orderStatus: order.status,
        stopStatus: null,
        driverLocation: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return this.toPublicPayload(stop.trip, stop);
  }

  /**
   * Deliberately minimal — no customer name/phone, no other stops on the
   * trip, no trip ID, no driver identity beyond a location point. This is
   * the ONLY thing an unauthenticated public subscriber ever receives.
   */
  private toPublicPayload(trip: Trip, stop: TripStop) {
    return {
      trackingNumber: stop.order.trackingNumber,
      orderReference: stop.order.orderReference,
      orderStatus: stop.order.status,
      stopStatus: stop.status,
      driverLocation: trip.driverLocationLat
        ? {
            lat: trip.driverLocationLat,
            lng: trip.driverLocationLng,
            updatedAt: trip.driverLocationUpdatedAt,
          }
        : null,
      updatedAt: new Date().toISOString(),
    };
  }
}
