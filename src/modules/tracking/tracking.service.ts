import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Trip } from '#/common/entities/trip.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { Order } from '#/common/entities/order.entity';
import { StopStatus } from '#/common/constants/stop-status.constant';
import {
  CONFIRM_RADIUS_METERS,
  HEARTBEAT_INTERVAL_MS,
  LARGE_GAP_THRESHOLD_SECONDS,
  MAX_ACCEPTABLE_ACCURACY_METERS,
  MAX_PLAUSIBLE_SPEED_KPH,
  MIN_MOVEMENT_METERS,
} from '#/common/constants/gps-validation.constant';
import {
  ForbiddenAppException,
  InternalErrorException,
  ResourceNotFoundException,
} from '#/common/exceptions';
import {
  deriveTripStatus,
  getCurrentStop,
  getTripProgress,
} from '#/common/utils/trip-status.util';
import {
  type GeoPoint,
  haversineDistanceMeters,
} from '#/common/utils/geo-distance.util';
import { UsersService } from '#/modules/users/users.service';
import { TrackingEmitterService } from './tracking-emitter.service';
import { RadarEtaService } from './radar-eta.service';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';
import {
  TRACKING_QUEUE_NAME,
  TrackingJobName,
} from './constants/tracking-queue.constant';
import { TRIP_EVENTS, TripUpdatedEvent } from '#/common/events/trip.events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { deriveTripActivity } from '#/common/utils/trip-activity.util';
import {
  DispatchService,
  TripDriver,
} from '#/modules/dispatch/dispatch.service';

export type LocationUpdateResult =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | 'low_accuracy'
        | 'stale_timestamp'
        | 'quarantined_pending_confirmation'
        | 'no_change';
    };

@Injectable()
export class TrackingService {
  private readonly logger: Logger = new Logger(TrackingService.name);
  constructor(
    @InjectRepository(Trip) private readonly tripRepo: Repository<Trip>,
    @InjectRepository(TripStop)
    private readonly tripStopRepo: Repository<TripStop>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    private readonly usersService: UsersService,
    private readonly emitter: TrackingEmitterService,
    private readonly radarEtaService: RadarEtaService,
    @Inject(forwardRef(() => DispatchService))
    private readonly dispatchService: DispatchService,
    @InjectQueue(TRACKING_QUEUE_NAME) private readonly trackingQueue: Queue,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Updates the live location of the driver assigned to a trip.
   *
   * Validates that the requesting user is assigned to the trip before
   * processing the location update. Incoming GPS fixes are filtered to ignore
   * stale, low-accuracy, or implausible locations while preserving the last
   * trusted location.
   *
   * @param tripId - The unique identifier of the trip.
   * @param driverUserId - The unique identifier of the driver.
   * @param dto - The driver's latest location update.
   *
   * @returns Whether the location update was accepted and, if rejected, the
   * reason for rejection.
   *
   * @throws {ResourceNotFoundException}
   * If the requested trip could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the requesting user is not allowed to update this trip.
   */
  async updateDriverLocation(
    tripId: string,
    driverUserId: string,
    dto: UpdateDriverLocationDto,
  ): Promise<LocationUpdateResult> {
    const trip = await this.tripRepo.findOne({
      where: { id: tripId },
      select: {
        id: true,
        driverUserId: true,
        driverLocationLat: true,
        driverLocationLng: true,
        driverLocationAccuracy: true,
        driverLocationClientTimestamp: true,
        driverLocationUpdatedAt: true,
        candidateLocationLat: true,
        candidateLocationLng: true,
        candidateLocationAt: true,
      },
    });

    if (!trip) {
      throw new ResourceNotFoundException(
        'The requested trip could not be found.',
      );
    }

    if (trip.driverUserId !== driverUserId) {
      throw new ForbiddenAppException(
        "You don't have permission to update this trip.",
      );
    }

    // Edge case: GPS fix is too imprecise to trust (for example, indoors or
    // in areas with poor signal). Ignore it without treating it as an error.
    if (
      dto.accuracyMeters !== undefined &&
      dto.accuracyMeters > MAX_ACCEPTABLE_ACCURACY_METERS
    ) {
      return {
        accepted: false,
        reason: 'low_accuracy',
      };
    }

    const newPoint: GeoPoint = {
      lat: dto.lat,
      lng: dto.lng,
    };

    const newTimestamp = dto.clientTimestamp
      ? new Date(dto.clientTimestamp)
      : new Date();

    // Ignore location updates that arrive out of order.
    if (
      trip.driverLocationClientTimestamp &&
      newTimestamp <= trip.driverLocationClientTimestamp
    ) {
      return {
        accepted: false,
        reason: 'stale_timestamp',
      };
    }

    const hasPriorLocation =
      trip.driverLocationLat !== null && trip.driverLocationLng !== null;

    if (hasPriorLocation) {
      const lastPoint: GeoPoint = {
        lat: trip.driverLocationLat!,
        lng: trip.driverLocationLng!,
      };

      const lastTimestamp =
        trip.driverLocationClientTimestamp ?? trip.driverLocationUpdatedAt!;

      const elapsedSeconds = Math.max(
        1,
        (newTimestamp.getTime() - lastTimestamp.getTime()) / 1000,
      );

      const distanceMeters = haversineDistanceMeters(lastPoint, newPoint);

      const impliedSpeedKph = distanceMeters / 1000 / (elapsedSeconds / 3600);

      // Detect unrealistic jumps caused by inaccurate GPS fixes.
      const isImplausibleJump =
        impliedSpeedKph > MAX_PLAUSIBLE_SPEED_KPH &&
        elapsedSeconds < LARGE_GAP_THRESHOLD_SECONDS;

      if (isImplausibleJump) {
        const hasCandidate =
          trip.candidateLocationLat !== null &&
          trip.candidateLocationLng !== null;

        if (hasCandidate) {
          const candidatePoint: GeoPoint = {
            lat: trip.candidateLocationLat!,
            lng: trip.candidateLocationLng!,
          };

          const distanceFromCandidate = haversineDistanceMeters(
            candidatePoint,
            newPoint,
          );

          if (distanceFromCandidate <= CONFIRM_RADIUS_METERS) {
            // Two consecutive readings agree, so accept the
            // location and clear the candidate.
            await this.persistAcceptedLocation(
              tripId,
              newPoint,
              dto.accuracyMeters ?? null,
              newTimestamp,
              true,
            );

            await this.enqueueTripBroadcast(tripId);

            return {
              accepted: true,
            };
          }
        }

        // Store the point temporarily until another update confirms it.
        await this.tripRepo.update(
          { id: tripId },
          {
            candidateLocationLat: newPoint.lat,
            candidateLocationLng: newPoint.lng,
            candidateLocationAt: newTimestamp,
          },
        );

        return {
          accepted: false,
          reason: 'quarantined_pending_confirmation',
        };
      }

      // Valid movement clears any previously quarantined candidate.
      const movedFarEnough = distanceMeters >= MIN_MOVEMENT_METERS;

      const staleEnoughForHeartbeat =
        !trip.driverLocationUpdatedAt ||
        Date.now() - trip.driverLocationUpdatedAt.getTime() >=
          HEARTBEAT_INTERVAL_MS;

      if (!movedFarEnough && !staleEnoughForHeartbeat) {
        return {
          accepted: false,
          reason: 'no_change',
        };
      }
    }

    await this.persistAcceptedLocation(
      tripId,
      newPoint,
      dto.accuracyMeters ?? null,
      newTimestamp,
      true,
    );

    await this.enqueueTripBroadcast(tripId);

    return {
      accepted: true,
    };
  }

  /**
   * Queues a background job to broadcast the latest trip update to connected
   * clients.
   *
   * The broadcast is processed asynchronously to avoid delaying the current
   * request. Failed jobs are retried automatically using an exponential
   * backoff strategy.
   *
   * @param tripId - The unique identifier of the trip whose latest state
   * should be broadcast.
   *
   * @returns A promise that resolves once the job has been added to the queue.
   *
   * @throws {InternalErrorException}
   * If the broadcast job could not be queued.
   */
  async enqueueTripBroadcast(tripId: string): Promise<void> {
    try {
      await this.trackingQueue.add(
        TrackingJobName.BROADCAST_TRIP_UPDATE,
        { tripId },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue trip broadcast for trip ${tripId}.`,
        error,
      );

      throw new InternalErrorException(
        "We couldn't process the trip update at the moment. Please try again.",
      );
    }
  }

  /**
   * Broadcasts the latest state of a trip to all subscribed clients.
   *
   * Retrieves the latest trip data, recalculates the ETA when possible,
   * broadcasts updates to internal dashboards and public tracking channels,
   * and publishes a domain event indicating that the trip has changed.
   *
   * If the trip no longer exists, the broadcast is skipped. This can happen
   * if the trip is deleted after the broadcast job is queued but before it is
   * processed.
   *
   * @param tripId - The unique identifier of the trip to broadcast.
   *
   * @returns A promise that resolves once all broadcasts have completed.
   */
  async broadcastTripUpdate(tripId: string): Promise<void> {
    try {
      const trip = await this.tripRepo.findOne({
        where: { id: tripId },
        relations: {
          stops: {
            order: {
              items: true,
            },
          },
        },
      });

      // Edge case: the trip was deleted after the job was queued.
      if (!trip) {
        return;
      }

      trip.stops.sort((a, b) => a.sequence - b.sequence);

      const currentStop = getCurrentStop(trip.stops);
      const eta = await this.resolveEta(trip, currentStop);

      if (eta) {
        trip.etaMinutes = eta.minutes;
        trip.etaCalculatedAt = new Date();
        trip.etaSource = eta.source;

        await this.tripRepo.update(
          { id: tripId },
          {
            etaMinutes: eta.minutes,
            etaCalculatedAt: trip.etaCalculatedAt,
            etaSource: eta.source,
          },
        );
      }

      const driver = (
        await this.dispatchService.getDriversForTrips(trip.companyId, [trip])
      ).get(trip.driverUserId);

      this.emitter.emitToInternalRoom(
        tripId,
        'trip:update',
        this.toInternalPayload(trip, driver),
      );

      for (const stop of trip.stops) {
        const stopEta =
          stop.id === currentStop?.id
            ? {
                minutes: trip.etaMinutes,
                source: trip.etaSource,
              }
            : null;

        this.emitter.emitToPublicRoom(
          stop.order.trackingNumber,
          'tracking:update',
          this.toPublicPayload(trip, stop, stopEta),
        );
      }

      this.events.emit(
        TRIP_EVENTS.UPDATED,
        new TripUpdatedEvent(trip.companyId),
      );
    } catch (error) {
      this.logger.error(
        `Failed to broadcast trip update for trip ${tripId}.`,
        error,
      );

      throw error;
    }
  }

  toInternalPayload(trip: Trip, driver: TripDriver | null) {
    const mappedStops = trip.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      orderId: stop.orderId,
      orderReference: stop.order.orderReference,
      trackingNumber: stop.order.trackingNumber,
      customerName: stop.order.customerName,
      customerPhone: stop.order.customerPhone,
      pickupSavedLocationId: stop.order.pickupSavedLocationId,
      pickupLocation: stop.order.pickupLocation,
      dropoffLocation: stop.order.dropoffLocation,
      priority: stop.order.priority,
      status: stop.status,
      arrivedAt: stop.arrivedAt,
      completedAt: stop.completedAt,
      skiReason: stop.skipReason,
      skipNote: stop.skipNote,
    }));

    const currentStop =
      mappedStops.find(
        (s) =>
          s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED,
      ) ?? null;

    return {
      id: trip.id,
      driver,
      status: deriveTripStatus(trip.stops),
      progress: getTripProgress(trip.stops),
      currentStop,
      eta: {
        minutes: trip.etaMinutes,
        source: trip.etaSource,
        calculatedAt: trip.etaCalculatedAt,
      },
      driverLocation: trip.driverLocationLat
        ? {
            lat: trip.driverLocationLat,
            lng: trip.driverLocationLng,
            accuracyMeters: trip.driverLocationAccuracy,
            updatedAt: trip.driverLocationUpdatedAt,
          }
        : null,
      stops: mappedStops,
      activity: deriveTripActivity(trip),
    };
  }

  /**
   * Verifies that a user is allowed to access a trip.
   *
   * Ensures the trip exists and confirms that the user belongs to the same
   * company as the trip.
   *
   * @param userId - The unique identifier of the user.
   * @param tripId - The unique identifier of the trip.
   *
   * @returns A promise that resolves if the user is authorized.
   *
   * @throws {ResourceNotFoundException}
   * If the requested trip could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the user does not have permission to access the trip.
   */
  async assertUserCanAccessTrip(userId: string, tripId: string): Promise<void> {
    const trip = await this.tripRepo.findOne({
      where: { id: tripId },
    });

    if (!trip) {
      throw new ResourceNotFoundException(
        'The requested trip could not be found.',
      );
    }

    const userRole = await this.usersService.getUserRoleByUserId(userId);

    if (userRole.companyId !== trip.companyId) {
      throw new ForbiddenAppException(
        "You don't have permission to access this trip.",
      );
    }
  }

  /**
   * Retrieves the public tracking snapshot for an order.
   *
   * Looks up an order by its tracking number and returns the latest tracking
   * information available. If the order has not yet been dispatched, a
   * snapshot is returned without trip or driver information.
   *
   * @param trackingNumber - The public tracking number of the order.
   *
   * @returns The current public tracking snapshot.
   *
   * @throws {ResourceNotFoundException}
   * If no order matches the supplied tracking number.
   */
  async getPublicSnapshotByTrackingNumber(trackingNumber: string) {
    const order = await this.orderRepo.findOne({
      where: { trackingNumber },
    });

    if (!order) {
      throw new ResourceNotFoundException(
        "We couldn't find any delivery with that tracking number.",
      );
    }

    const stop = await this.tripStopRepo.findOne({
      where: {
        orderId: order.id,
      },
      relations: {
        trip: true,
        order: true,
      },
    });

    // The order exists but has not yet been assigned to a trip.
    if (!stop) {
      return {
        trackingNumber,
        orderReference: order.orderReference,
        orderStatus: order.status,
        stopStatus: null,
        eta: null,
        driverLocation: null,
        updatedAt: new Date().toISOString(),
      };
    }

    const eta =
      stop.trip.etaMinutes !== null
        ? {
            minutes: stop.trip.etaMinutes,
            source: stop.trip.etaSource,
          }
        : null;

    return this.toPublicPayload(stop.trip, stop, eta);
  }

  /**
   * Persists a validated driver location for a trip.
   *
   * Updates the trip's latest accepted driver location, accuracy, and client
   * timestamp. Optionally clears any quarantined candidate location once the
   * new location has been accepted.
   *
   * @param tripId - The unique identifier of the trip.
   * @param point - The validated geographic coordinates.
   * @param accuracyMeters - The reported GPS accuracy in meters, if available.
   * @param clientTimestamp - The time the location was recorded on the driver's device.
   * @param clearCandidate - Whether any quarantined candidate location should be cleared.
   *
   * @returns A promise that resolves once the location has been persisted.
   */
  private async persistAcceptedLocation(
    tripId: string,
    point: GeoPoint,
    accuracyMeters: number | null,
    clientTimestamp: Date,
    clearCandidate: boolean,
  ): Promise<void> {
    await this.tripRepo.update(
      { id: tripId },
      {
        driverLocationLat: point.lat,
        driverLocationLng: point.lng,
        driverLocationAccuracy: accuracyMeters,
        driverLocationClientTimestamp: clientTimestamp,
        driverLocationUpdatedAt: new Date(),
        ...(clearCandidate
          ? {
              candidateLocationLat: null,
              candidateLocationLng: null,
              candidateLocationAt: null,
            }
          : {}),
      },
    );
  }

  /**
   * Resolves the estimated arrival time for the current trip stop.
   *
   * Uses the driver's latest accepted location and the destination of the
   * current stop to calculate an ETA. If the live ETA service is unavailable,
   * a recently cached ETA is returned when possible before falling back to an
   * unavailable state.
   *
   * @param trip - The trip containing the driver's latest location and cached ETA.
   * @param currentStop - The current active stop, if one exists.
   *
   * @returns The resolved ETA and its source, or `null` if an ETA cannot yet
   * be calculated because the trip has no active stop or no driver location.
   */
  private async resolveEta(
    trip: Trip,
    currentStop: TripStop | null,
  ): Promise<{
    minutes: number | null;
    source: 'radar' | 'cached' | 'unavailable';
  } | null> {
    // No ETA can be calculated until there is an active stop and at least
    // one accepted driver location.
    if (
      !currentStop ||
      trip.driverLocationLat === null ||
      trip.driverLocationLng === null
    ) {
      return null;
    }

    const target =
      currentStop.status === StopStatus.PENDING
        ? currentStop.order.pickupLocation
        : currentStop.order.dropoffLocation;

    const result = await this.radarEtaService.getEtaMinutes(
      {
        lat: trip.driverLocationLat,
        lng: trip.driverLocationLng,
      },
      {
        lat: target.lat,
        lng: target.lng,
      },
    );

    if (result.source === 'radar') {
      return result;
    }

    // Fall back to a recently calculated ETA if the live provider is
    // temporarily unavailable.
    if (trip.etaMinutes !== null && trip.etaCalculatedAt) {
      const ageMs = Date.now() - trip.etaCalculatedAt.getTime();

      if (ageMs < 5 * 60_000) {
        return {
          minutes: trip.etaMinutes,
          source: 'cached',
        };
      }
    }

    return {
      minutes: null,
      source: 'unavailable',
    };
  }

  private toPublicPayload(
    trip: Trip,
    stop: TripStop,
    eta: { minutes: number | null; source: string | null } | null,
  ) {
    return {
      trackingNumber: stop.order.trackingNumber,
      orderReference: stop.order.orderReference,
      orderStatus: stop.order.status,
      stopStatus: stop.status,
      eta,
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
