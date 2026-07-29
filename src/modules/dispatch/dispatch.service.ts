import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { Trip } from '#/common/entities/trip.entity';
import {
  ProofOfDeliveryMethod,
  TripStop,
} from '#/common/entities/trip-stop.entity';
import { StopStatus } from '#/common/constants/stop-status.constant';
import { OrderStatus } from '#/common/constants/order-status.constant';
import { TripStatus } from '#/common/constants/trip-status.constant';
import { TeamRoleType } from '#/common/types/team-role.type';
import {
  deriveTripStatus,
  getTripProgress,
} from '#/common/utils/trip-status.util';
import {
  BadRequestAppException,
  ForbiddenAppException,
  ResourceNotFoundException,
} from '#/common/exceptions';
import { OrdersService } from '#/modules/orders/orders.service';
import { UsersService } from '#/modules/users/users.service';
import { TrackingService } from '#/modules/tracking/tracking.service';
import { DispatchOrdersDto } from './dto/dispatch-orders.dto';
import { SkipStopDto } from './dto/skip-stop.dto';
import { ListTripsQueryDto } from './dto/list-trips.query.dto';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import { TRIP_EVENTS, TripUpdatedEvent } from '#/common/events/trip.events';
import { StorageService } from '#/common/storage/storage.service';
import { StoragePath } from '#/common/storage/storage-path.util';
import { CompleteStopDto } from './dto/complete-stop.dto';
import { UserRole } from '#/common/entities/user-role.entity';
import { deriveTripActivity } from '#/common/utils/trip-activity.util';
import { ErrorHandlerService } from '#/common/errors/error-handler.service';
import {
  STOP_EVENTS,
  StopArrivedEvent,
  StopCompletedEvent,
  StopSkippedEvent,
} from '#/common/events/stop.events';

export type TripDriver = {
  id: string;
  driverName: string;
  avatarUrl: string | null;
  phone: string | null;
};

@Injectable()
export class DispatchService {
  private readonly ORDER_PROGRESSION: OrderStatus[] = [
    OrderStatus.ASSIGNED,
    OrderStatus.PICKED_UP,
    OrderStatus.IN_TRANSIT,
  ];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Trip) private readonly tripRepo: Repository<Trip>,
    @InjectRepository(TripStop)
    private readonly tripStopRepo: Repository<TripStop>,
    private readonly ordersService: OrdersService,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => TrackingService))
    private readonly trackingService: TrackingService,
    private readonly cache: RedisCacheService,
    private readonly storageService: StorageService,
    private readonly errorHandler: ErrorHandlerService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Dispatches order to a driver by creating a delivery trip.
   *
   * Validates the selected driver, creates a trip, assigns pending order to
   * the driver, creates trip stops, and broadcasts the trip update after
   * successful dispatch.
   *
   * @param companyId - The unique identifier of the company.
   * @param dispatcherUserId - The unique identifier of the user dispatching order.
   * @param dto - The dispatch request containing the driver and order.
   *
   * @returns The created trip with its assigned stops.
   *
   * @throws {BadRequestAppException}
   * If the selected user is not a driver or an order cannot be dispatched.
   *
   * @throws {ResourceNotFoundException}
   * If the driver or order could not be found.
   *
   * @throws {ForbiddenAppException}
   * If an order does not belong to the company.
   */
  async dispatchOrdersToDriver(
    companyId: string,
    dispatcherUserId: string,
    dto: DispatchOrdersDto,
  ): Promise<void> {
    try {
      const driverRole = await this.usersService.getUserRole(
        dto.driverUserId,
        companyId,
      );

      if (driverRole.role !== TeamRoleType.DRIVER) {
        throw new BadRequestAppException(
          'The selected user is not available as a driver.',
        );
      }

      const savedTrip = await this.withTransaction(undefined, async (trx) => {
        const trip = trx.getRepository(Trip).create({
          companyId,
          driverUserId: dto.driverUserId,
          createdByUserId: dispatcherUserId,
        });

        const trip_ = await trx.getRepository(Trip).save(trip);

        const stops: TripStop[] = [];

        for (let i = 0; i < dto.orderIds.length; i++) {
          const orderId = dto.orderIds[i];

          const order = await this.ordersService.getOrderByIdForCompany(
            orderId,
            companyId,
            trx,
          );

          if (order.status !== OrderStatus.PENDING) {
            throw new BadRequestAppException(
              'One or more selected order are no longer available for dispatch.',
            );
          }

          await this.ordersService.assignDriverForCompany(
            orderId,
            companyId,
            dispatcherUserId,
            dto.driverUserId,
            trx,
          );

          const stop = trx.getRepository(TripStop).create({
            tripId: trip_.id,
            orderId,
            sequence: i + 1,
            status: StopStatus.PENDING,
          });

          stops.push(await trx.getRepository(TripStop).save(stop));
        }

        trip_.stops = stops;

        return trip_;
      });

      await this.trackingService.broadcastTripUpdate(savedTrip.id);
    } catch (err) {
      this.errorHandler.handle(err, 'DispatchService.dispatchOrdersToDriver');
    }
  }

  /**
   * Retrieves a trip and verifies that it belongs to a company.
   *
   * Includes trip stops with their associated order and order items.
   * Stops are returned in their delivery sequence order.
   *
   * @param tripId - The unique identifier of the trip.
   * @param companyId - The unique identifier of the company.
   * @param manager - Optional transaction entity manager.
   *
   * @returns The trip details with ordered stops.
   *
   * @throws {ResourceNotFoundException}
   * If the trip could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the trip is not accessible by the company.
   */
  async getTripForCompany(
    tripId: string,
    companyId: string,
    manager?: EntityManager,
  ): Promise<Trip> {
    try {
      const repo = manager ? manager.getRepository(Trip) : this.tripRepo;

      const trip = await repo.findOne({
        where: { id: tripId },
        relations: {
          stops: {
            order: {
              items: true,
            },
          },
        },
      });

      if (!trip) {
        throw new ResourceNotFoundException(
          'The trip you are looking for could not be found.',
        );
      }

      if (trip.companyId !== companyId) {
        throw new ForbiddenAppException(
          'You do not have permission to access this trip.',
        );
      }

      trip.stops.sort((a, b) => a.sequence - b.sequence);

      return trip;
    } catch (err) {
      this.errorHandler.handle(err, 'DispatchService.getTripForCompany');
    }
  }

  /**
   * Retrieves a paginated list of trips for a company.
   *
   * Uses cached results for regular trip listing requests to improve performance.
   * Cache is bypassed when searching because search results are more dynamic.
   *
   * @param companyId - The unique identifier of the company.
   * @param query - The trip listing filters and pagination options.
   *
   * @returns A list of company trips with pagination information.
   */
  async listTripsForCompany(companyId: string, query: ListTripsQueryDto) {
    if (query.search) {
      return this.computeTripsList(companyId, query);
    }

    const cacheKey = this.buildTripsListCacheKey(companyId, query);

    return this.cache.getOrSet(cacheKey, 10, () =>
      this.computeTripsList(companyId, query),
    );
  }

  /**
   * Marks a trip stop as arrived.
   *
   * Verifies that the stop belongs to the company, updates the related order
   * status to in transit, records the arrival time, starts the trip if it has
   * not already started, and broadcasts the trip update.
   *
   * @param tripId - The unique identifier of the trip.
   * @param stopId - The unique identifier of the trip stop.
   * @param companyId - The unique identifier of the company.
   * @param updatedByUserId - The unique identifier of the person who perform this action.
   *
   * @returns The updated trip stop.
   *
   * @throws {ResourceNotFoundException}
   * If the trip or stop could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the trip stop is not accessible by the company.
   *
   * @throws {BadRequestAppException}
   * If the stop has already been processed.
   */
  async arriveAtStop(
    tripId: string,
    stopId: string,
    companyId: string,
    updatedByUserId: string,
  ): Promise<void> {
    try {
      const savedStop = await this.withTransaction(undefined, async (trx) => {
        const { trip, stop } = await this.getStopForCompany(
          tripId,
          stopId,
          companyId,
          trx,
        );

        if (stop.status !== StopStatus.PENDING) {
          throw new BadRequestAppException(
            'This stop has already been processed.',
          );
        }

        await this.advanceOrderTo(
          stop.orderId,
          companyId,
          OrderStatus.IN_TRANSIT,
          updatedByUserId,
          trx,
        );

        if (!trip.startedAt) {
          trip.startedAt = new Date();

          await trx.getRepository(Trip).save(trip);
        }

        stop.status = StopStatus.ARRIVED;
        stop.arrivedAt = new Date();

        return trx.getRepository(TripStop).save(stop);
      });

      this.events.emit(
        STOP_EVENTS.ARRIVED,
        new StopArrivedEvent(
          companyId,
          savedStop.order.orderReference,
          savedStop.order.customerName,
        ),
      );
      await this.trackingService.broadcastTripUpdate(tripId);
    } catch (err) {
      this.errorHandler.handle(err, 'DispatchService.arriveAtStop');
    }
  }

  /**
   * Completes a trip stop with proof of delivery information.
   *
   * Validates required proof-of-delivery files, uploads delivery evidence,
   * updates the related order status to delivered, records completion details,
   * and broadcasts the trip update.
   *
   * @param tripId - The unique identifier of the trip.
   * @param stopId - The unique identifier of the trip stop.
   * @param companyId - The unique identifier of the company.
   * @param updatedByUserId - The unique identifier of the person who perfrom the action.
   * @param dto - The completion details and proof-of-delivery method.
   * @param files - Optional proof-of-delivery files such as photo or signature.
   *
   * @returns The completed trip stop.
   *
   * @throws {BadRequestAppException}
   * If required proof-of-delivery information is missing or the stop cannot
   * be completed in its current state.
   *
   * @throws {ResourceNotFoundException}
   * If the trip or stop could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the trip stop is not accessible by the company.
   */
  async completeStop(
    tripId: string,
    stopId: string,
    companyId: string,
    updatedByUserId: string,
    dto: CompleteStopDto,
    files: {
      photo?: {
        buffer: Buffer;
        contentType: string;
        extension: string;
      };
      signature?: {
        buffer: Buffer;
        contentType: string;
        extension: string;
      };
    },
  ): Promise<TripStop> {
    try {
      const requiresPhoto =
        dto.podMethod === ProofOfDeliveryMethod.PHOTO ||
        dto.podMethod === ProofOfDeliveryMethod.PHOTO_AND_SIGNATURE;

      const requiresSignature =
        dto.podMethod === ProofOfDeliveryMethod.SIGNATURE ||
        dto.podMethod === ProofOfDeliveryMethod.PHOTO_AND_SIGNATURE;

      if (requiresPhoto && !files.photo) {
        throw new BadRequestAppException(
          'A delivery photo is required to complete this delivery.',
        );
      }

      if (requiresSignature && !files.signature) {
        throw new BadRequestAppException(
          'A signature is required to complete this delivery.',
        );
      }

      let podPhotoUrl: string | undefined;
      let podSignatureUrl: string | undefined;

      if (files.photo) {
        podPhotoUrl = await this.storageService.uploadFile({
          path: StoragePath.proofOfDelivery(
            companyId,
            stopId,
            `photo.${files.photo.extension}`,
          ),
          buffer: files.photo.buffer,
          contentType: files.photo.contentType,
        });
      }

      if (files.signature) {
        podSignatureUrl = await this.storageService.uploadFile({
          path: StoragePath.proofOfDelivery(
            companyId,
            stopId,
            `signature.${files.signature.extension}`,
          ),
          buffer: files.signature.buffer,
          contentType: files.signature.contentType,
        });
      }

      const savedStop = await this.withTransaction(undefined, async (trx) => {
        const { stop } = await this.getStopForCompany(
          tripId,
          stopId,
          companyId,
          trx,
        );

        if (stop.status !== StopStatus.ARRIVED) {
          throw new BadRequestAppException(
            'This delivery cannot be completed yet.',
          );
        }

        await this.advanceOrderTo(
          stop.orderId,
          companyId,
          OrderStatus.IN_TRANSIT,
          updatedByUserId,
          trx,
        );

        await this.ordersService.updateOrderStatusForCompany(
          stop.orderId,
          companyId,
          {
            status: OrderStatus.DELIVERED,
          },
          updatedByUserId,
          trx,
        );

        stop.status = StopStatus.COMPLETED;
        stop.completedAt = new Date();
        stop.podMethod = dto.podMethod;
        stop.podPhotoUrl = podPhotoUrl ?? null;
        stop.podSignatureUrl = podSignatureUrl ?? null;
        stop.podRecipientName = dto.recipientName ?? null;
        stop.podNotes = dto.notes ?? null;
        stop.podCapturedAt = new Date();

        return trx.getRepository(TripStop).save(stop);
      });

      this.events.emit(
        STOP_EVENTS.COMPLETED,
        new StopCompletedEvent(
          companyId,
          savedStop.order.orderReference,
          savedStop.order.customerName,
        ),
      );

      await this.trackingService.broadcastTripUpdate(tripId);

      return savedStop;
    } catch (err) {
      this.errorHandler.handle(err, 'DispatchService.completedStop');
    }
  }

  /**
   * Skips a trip stop and marks the related order as failed.
   *
   * Verifies that the stop can be skipped, updates the related order status,
   * records the skip reason, and broadcasts the trip update.
   *
   * @param tripId - The unique identifier of the trip.
   * @param stopId - The unique identifier of the trip stop.
   * @param companyId - The unique identifier of the company.
   * @param updatedByUserId - The unique identifier of the person who perform the action.
   * @param dto - The skip reason and optional note.
   *
   * @returns The updated trip stop.
   *
   * @throws {BadRequestAppException}
   * If the stop has already been completed or skipped.
   *
   * @throws {ResourceNotFoundException}
   * If the trip or stop could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the trip stop is not accessible by the company.
   */
  async skipStop(
    tripId: string,
    stopId: string,
    companyId: string,
    updatedByUserId: string,
    dto: SkipStopDto,
  ): Promise<TripStop> {
    try {
      const savedStop = await this.withTransaction(undefined, async (trx) => {
        const { stop } = await this.getStopForCompany(
          tripId,
          stopId,
          companyId,
          trx,
        );

        if (
          stop.status === StopStatus.COMPLETED ||
          stop.status === StopStatus.SKIPPED
        ) {
          throw new BadRequestAppException(
            'This delivery stop can no longer be skipped.',
          );
        }

        await this.advanceOrderTo(
          stop.orderId,
          companyId,
          OrderStatus.IN_TRANSIT,
          updatedByUserId,
          trx,
        );

        await this.ordersService.updateOrderStatusForCompany(
          stop.orderId,
          companyId,
          {
            status: OrderStatus.FAILED,
          },
          updatedByUserId,
          trx,
        );

        stop.status = StopStatus.SKIPPED;
        stop.skipReason = dto.reason;
        stop.skipNote = dto.note ?? null;

        return trx.getRepository(TripStop).save(stop);
      });

      this.events.emit(
        STOP_EVENTS.SKIPPED,
        new StopSkippedEvent(
          companyId,
          savedStop.order.orderReference,
          savedStop.order.customerName,
          dto.reason,
        ),
      );
      await this.trackingService.broadcastTripUpdate(tripId);

      return savedStop;
    } catch (err) {
      this.errorHandler.handle(err, 'DispatchService.skipStop');
    }
  }

  /**
   * Retrieves company trips with assigned driver information.
   *
   * Fetches the company's trips and enriches each trip with driver details
   * before returning the response. Trips without an available driver record
   * will still be returned with no driver information.
   *
   * @param companyId - The unique identifier of the company.
   * @param query - The trip listing filters and pagination options.
   *
   * @returns A paginated list of trips including driver information.
   */
  async listTripsForCompanyWithDriverNames(
    companyId: string,
    query: ListTripsQueryDto,
  ) {
    const result = await this.listTripsForCompany(companyId, query);

    const drivers = await this.getDriversForTrips(companyId, result.trips);

    return {
      ...result,
      trips: result.trips.map((trip) =>
        this.toTripResponse(trip, drivers.get(trip.driverUserId) ?? null),
      ),
    };
  }

  toTripResponse(trip: Trip, driver: TripDriver | null = null) {
    const mappedStops = trip.stops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      orderId: stop.orderId,
      orderReference: stop.order.orderReference,
      trackingNumber: stop.order.trackingNumber,
      customerName: stop.order.customerName,
      customerPhone: stop.order.customerPhone,
      pickupLocation: stop.order.pickupLocation,
      pickupSavedLocationId: stop.order.pickupSavedLocationId,
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
      podCapturedAt: stop.podCapturedAt,
    }));

    const currentStop =
      mappedStops.find(
        (s) =>
          s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED,
      ) ?? null;

    return {
      id: trip.id,
      driver,
      createdAt: trip.createdAt,
      startedAt: trip.startedAt,
      status: deriveTripStatus(trip.stops),
      progress: getTripProgress(trip.stops),
      currentStop,
      activity: deriveTripActivity(trip),
      eta: {
        minutes: trip.etaMinutes,
        source: trip.etaSource,
        calculatedAt: trip.etaCalculatedAt,
      },
      driverLocation:
        trip.driverLocationLat !== null && trip.driverLocationLng !== null
          ? {
              lat: trip.driverLocationLat,
              lng: trip.driverLocationLng,
              accuracyMeters: trip.driverLocationAccuracy,
              updatedAt: trip.driverLocationUpdatedAt,
            }
          : null,
      stops: mappedStops,
    };
  }

  /**
   * Actively invalidates on every trip-affecting event — the short 10s TTL
   * alone isn't tight enough given how frequently trip state changes
   * (every arrive/complete/skip), so staleness is bounded by whichever
   * comes first: this invalidation, or the TTL. Only the exact status-keyed
   * variants are cleared (page/pageSize combinations aren't enumerated
   * individually — a stale page-2 entry simply expires via its own TTL,
   * which is an acceptable few-seconds staleness for a less commonly hit
   * page, versus enumerating every page/size combination on every event).
   */
  @OnEvent(TRIP_EVENTS.UPDATED)
  async handleTripUpdated(event: TripUpdatedEvent) {
    const statusVariants = [
      undefined,
      TripStatus.SCHEDULED,
      TripStatus.IN_PROGRESS,
      TripStatus.COMPLETED,
    ];
    const keys = statusVariants.map((status) =>
      this.buildTripsListCacheKey(event.companyId, {
        status,
        page: 1,
        pageSize: 20,
      } as ListTripsQueryDto),
    );
    await this.cache.del(...keys);
  }

  /** Batch-resolves driverUserId -> name for a page of trips in ONE query*/
  async getDriversForTrips(companyId: string, trips: Trip[]) {
    const driverIds = [...new Set(trips.map((t) => t.driverUserId))];

    if (driverIds.length === 0) {
      return new Map();
    }

    const drivers = await this.userRoleRepo.find({
      where: {
        companyId,
        userId: In(driverIds),
      },
      select: {
        userId: true,
        name: true,
      },
    });

    const results = await Promise.all(
      drivers.map(async (driver) => {
        const user = await this.usersService.getUserFromSupabase(
          driver.userId as string,
        );

        return {
          id: driver.userId,
          driverName: driver.name,
          avatarUrl: user.user_metadata?.avatar_url ?? null,
          phone: user.user_metadata?.phone ?? null,
        };
      }),
    );

    return new Map(results.map((driver) => [driver.id, driver]));
  }

  private async withTransaction<T>(
    manager: EntityManager | undefined,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (manager) return work(manager);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private async getStopForCompany(
    tripId: string,
    stopId: string,
    companyId: string,
    manager: EntityManager,
  ): Promise<{ trip: Trip; stop: TripStop }> {
    const trip = await manager
      .getRepository(Trip)
      .findOne({ where: { id: tripId } });
    if (!trip) throw new ResourceNotFoundException('This trip cannot be found');
    if (trip.companyId !== companyId) {
      throw new ForbiddenAppException(
        'This trip does not belong to your company',
      );
    }

    const stop = await manager
      .getRepository(TripStop)
      .findOne({ where: { id: stopId, tripId } });
    if (!stop)
      throw new ResourceNotFoundException('This trip stop cannot be found');

    return { trip, stop };
  }

  private async advanceOrderTo(
    orderId: string,
    companyId: string,
    target: OrderStatus,
    updatedByUserId: string,
    manager: EntityManager,
  ): Promise<void> {
    const order = await this.ordersService.getOrderByIdForCompany(
      orderId,
      companyId,
      manager,
    );
    const currentIndex = this.ORDER_PROGRESSION.indexOf(order.status);
    const targetIndex = this.ORDER_PROGRESSION.indexOf(target);

    if (
      currentIndex === -1 ||
      targetIndex === -1 ||
      currentIndex >= targetIndex
    ) {
      return;
    }

    for (let i = currentIndex + 1; i <= targetIndex; i++) {
      await this.ordersService.updateOrderStatusForCompany(
        orderId,
        companyId,
        { status: this.ORDER_PROGRESSION[i] },
        updatedByUserId,
        manager,
      );
    }
  }

  private async computeTripsList(companyId: string, query: ListTripsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // Initialize the QueryBuilder and join relations
    const qb = this.tripRepo
      .createQueryBuilder('trip')
      .leftJoinAndSelect('trip.stops', 'stop')
      .leftJoinAndSelect('stop.order', 'order')
      .where('trip.companyId = :companyId', { companyId })
      .orderBy('trip.createdAt', 'DESC');

    // Apply customer search filter if present
    if (query.search) {
      qb.andWhere(
        new Brackets((sqb) => {
          sqb.where('LOWER(order.customerName) LIKE LOWER(:search)', {
            search: `%${query.search}%`,
          });
        }),
      );
    }

    // Execute the query
    const trips = await qb.getMany();

    // In-memory filter for derived status
    let filtered = trips;
    if (query.status) {
      filtered = filtered.filter(
        (trip) => deriveTripStatus(trip.stops) === query.status,
      );
    }

    // Paginate results in memory
    const total = filtered.length;
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

    return { trips: paged, total, page, pageSize };
  }

  private buildTripsListCacheKey(
    companyId: string,
    query: ListTripsQueryDto,
  ): string {
    return `trips:list:${companyId}:${query.status ?? ''}:${
      query.page ?? 1
    }:${query.pageSize ?? 20}`;
  }
}
