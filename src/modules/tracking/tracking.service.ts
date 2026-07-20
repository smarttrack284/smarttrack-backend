import { Injectable } from '@nestjs/common';
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
import { ForbiddenAppException, ResourceNotFoundException, } from '#/common/exceptions';
import { deriveTripStatus, getCurrentStop, getTripProgress, } from '#/common/utils/trip-status.util';
import { type GeoPoint, haversineDistanceMeters, } from '#/common/utils/geo-distance.util';
import { UsersService } from '#/modules/users/users.service';
import { TrackingEmitterService } from './tracking-emitter.service';
import { RadarEtaService } from './radar-eta.service';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';
import { TRACKING_QUEUE_NAME, TrackingJobName, } from './constants/tracking-queue.constant';
import { TRIP_EVENTS, TripUpdatedEvent } from '#/common/events/trip.events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { deriveTripActivity } from '#/common/utils/trip-activity.util';

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
  constructor(
    @InjectRepository(Trip) private readonly tripRepo: Repository<Trip>,
    @InjectRepository(TripStop)
    private readonly tripStopRepo: Repository<TripStop>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    private readonly usersService: UsersService,
    private readonly emitter: TrackingEmitterService,
    private readonly radarEtaService: RadarEtaService,
    @InjectQueue(TRACKING_QUEUE_NAME) private readonly trackingQueue: Queue,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * The low-latency ingest path. Validates the GPS fix is trustworthy
   * before touching anything, decides whether it represents real new
   * information worth persisting, writes at most one row, and only then
   * enqueues the expensive rebuild/broadcast. Never calls Radar directly —
   * that only happens inside the queued job.
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
    if (!trip) throw new ResourceNotFoundException('Trip', tripId);
    if (trip.driverUserId !== driverUserId) {
      throw new ForbiddenAppException(
        'You are not the driver assigned to this trip',
      );
    }

    // Edge case: GPS fix too imprecise to trust (indoors, urban canyon).
    // Discarded quietly rather than erroring — this is a normal, frequent
    // occurrence for a moving device, not a client bug.
    if (
      dto.accuracyMeters !== undefined &&
      dto.accuracyMeters > MAX_ACCEPTABLE_ACCURACY_METERS
    ) {
      return { accepted: false, reason: 'low_accuracy' };
    }

    const newPoint: GeoPoint = { lat: dto.lat, lng: dto.lng };
    const newTimestamp = dto.clientTimestamp
      ? new Date(dto.clientTimestamp)
      : new Date();

    // Edge case: out-of-order delivery (mobile network retry re-sends an
    // older point after a newer one already landed).
    if (
      trip.driverLocationClientTimestamp &&
      newTimestamp <= trip.driverLocationClientTimestamp
    ) {
      return { accepted: false, reason: 'stale_timestamp' };
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

      // Edge case: implausible jump in a short time window — likely a bad
      // GPS fix, not real movement, UNLESS enough time has passed that a
      // large jump is plausible anyway (device was offline/backgrounded).
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
            // Two consecutive points agree — this is real movement, not a
            // glitch. Accept the NEW point as the confirmed location and
            // clear the candidate.
            await this.persistAcceptedLocation(
              tripId,
              newPoint,
              dto.accuracyMeters ?? null,
              newTimestamp,
              true,
            );
            await this.enqueueTripBroadcast(tripId);
            return { accepted: true };
          }
        }

        // No corroborating follow-up yet — quarantine this point rather
        // than trusting or discarding it outright.
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

      // A plausible point arrived — any previously quarantined candidate
      // was a one-off glitch, not the start of a real trend. Clear it.
      const movedFarEnough = distanceMeters >= MIN_MOVEMENT_METERS;
      const staleEnoughForHeartbeat =
        !trip.driverLocationUpdatedAt ||
        Date.now() - trip.driverLocationUpdatedAt.getTime() >=
          HEARTBEAT_INTERVAL_MS;

      if (!movedFarEnough && !staleEnoughForHeartbeat) {
        return { accepted: false, reason: 'no_change' };
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
    return { accepted: true };
  }

  async enqueueTripBroadcast(tripId: string): Promise<void> {
    await this.trackingQueue.add(
      TrackingJobName.BROADCAST_TRIP_UPDATE,
      { tripId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    );
  }

  /**
   * Rebuilds a trip's current state — including a REAL routed ETA from
   * Radar, never a straight-line guess — and emits it. Runs inside
   * TrackingBroadcastProcessor for the driver-GPS-frequency path, or
   * synchronously for the two low-frequency cases where an immediate
   * result matters more than avoiding a small delay: a socket subscribing
   * for the first time, and dispatcher-triggered stop actions.
   */
  async broadcastTripUpdate(tripId: string): Promise<void> {
    const trip = await this.tripRepo.findOne({
      where: { id: tripId },
      relations: { stops: { order: { items: true } } },
    });
    if (!trip) return; // edge case: trip was deleted between enqueue and processing
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

    this.emitter.emitToInternalRoom(
      tripId,
      'trip:update',
      this.toInternalPayload(trip),
    );

    for (const stop of trip.stops) {
      const stopEta =
        stop.id === currentStop?.id
          ? { minutes: trip.etaMinutes, source: trip.etaSource }
          : null;
      this.emitter.emitToPublicRoom(
        stop.order.trackingNumber,
        'tracking:update',
        this.toPublicPayload(trip, stop, stopEta),
      );
    }

    this.events.emit(TRIP_EVENTS.UPDATED, new TripUpdatedEvent(trip.companyId));
  }

  toInternalPayload(trip: Trip) {
    return {
      id: trip.id,
      driverUserId: trip.driverUserId,
      status: deriveTripStatus(trip.stops),
      progress: getTripProgress(trip.stops),
      currentStop: getCurrentStop(trip.stops),
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
      stops: trip.stops.map((stop) => ({
        id: stop.id,
        sequence: stop.sequence,
        orderId: stop.orderId,
        orderReference: stop.order.orderReference,
        trackingNumber: stop.order.trackingNumber,
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
        podMethod: stop.podMethod,
            podPhotoUrl: stop.podPhotoUrl,
            podSignatureUrl: stop.podSignatureUrl,
            podRecipientName: stop.podRecipientName,
            podNotes: stop.podNotes,
            podCapturedAt: stop.podCapturedAt
      })),
      activity: deriveTripActivity(trip),
    };
  }

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

  async getPublicSnapshotByTrackingNumber(trackingNumber: string) {
    const order = await this.orderRepo.findOne({
      where: { trackingNumber },
    });
    if (!order) throw new ResourceNotFoundException('Order');

    const stop = await this.tripStopRepo.findOne({
      where: { orderId: order.id },
      relations: { trip: true, order: true },
    });
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
        ? { minutes: stop.trip.etaMinutes, source: stop.trip.etaSource }
        : null;

    return this.toPublicPayload(stop.trip, stop, eta);
  }

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
   * Calls RadarEtaService for a real routed duration. If Radar is
   * unavailable/rate-limited, falls back to the LAST KNOWN real ETA
   * (still radar-sourced originally, just aging) rather than fabricating
   * a new number — the payload's etaSource tells the frontend explicitly
   * which case occurred, so it can show "ETA unavailable" honestly
   * instead of a number that looks precise but isn't trustworthy.
   */
  private async resolveEta(
    trip: Trip,
    currentStop: TripStop | null,
  ): Promise<{
    minutes: number | null;
    source: 'radar' | 'cached' | 'unavailable';
  } | null> {
    if (
      !currentStop ||
      trip.driverLocationLat === null ||
      trip.driverLocationLng === null
    ) {
      return null; // edge case: no active stop, or no location yet — no ETA to show
    }

    const target =
      currentStop.status === StopStatus.PENDING
        ? currentStop.order.pickupLocation
        : currentStop.order.dropoffLocation;

    const result = await this.radarEtaService.getEtaMinutes(
      { lat: trip.driverLocationLat, lng: trip.driverLocationLng },
      { lat: target.lat, lng: target.lng },
    );

    if (result.source === 'radar') {
      return result;
    }

    // Radar call failed this round — fall back to the previous real value
    // if it's not too old, rather than showing nothing at all for a
    // single transient failure.
    if (trip.etaMinutes !== null && trip.etaCalculatedAt) {
      const ageMs = Date.now() - trip.etaCalculatedAt.getTime();
      if (ageMs < 5 * 60_000) {
        return { minutes: trip.etaMinutes, source: 'cached' };
      }
    }

    return { minutes: null, source: 'unavailable' };
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
