import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { Trip } from "#/common/entities/trip.entity";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { StopStatus } from "#/common/constants/stop-status.constant";
import { OrderStatus } from "#/common/constants/order-status.constant";
import { TeamRoleType } from "#/common/types/team-role.type";
import {
    deriveTripStatus,
    getCurrentStop,
    getTripProgress
} from "#/common/utils/trip-status.util";
import {
    BadRequestAppException,
    ForbiddenAppException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { OrdersService } from "#/modules/orders/orders.service";
import { UsersService } from "#/modules/users/users.service";
import { TrackingService } from "#/modules/tracking/tracking.service";
import { DispatchOrdersDto } from "./dto/dispatch-orders.dto";
import { SkipStopDto } from "./dto/skip-stop.dto";
import { ListTripsQueryDto } from "./dto/list-trips.query.dto";

@Injectable()
export class DispatchService {
    private readonly ORDER_PROGRESSION: OrderStatus[] = [
        OrderStatus.ASSIGNED,
        OrderStatus.PICKED_UP,
        OrderStatus.IN_TRANSIT
    ];

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(Trip) private readonly tripRepo: Repository<Trip>,
        @InjectRepository(TripStop)
        private readonly tripStopRepo: Repository<TripStop>,
        private readonly ordersService: OrdersService,
        private readonly usersService: UsersService,
        private readonly trackingService: TrackingService
    ) {}

    /**
     * Creates a trip: assigns a set of pending orders, in a specific
     * sequence, to a driver. Each order's assignment goes through
     * OrdersService.assignDriverForCompany, which already validates the
     * PENDING -> ASSIGNED transition and sets assignedDriverUserId — this
     * method doesn't duplicate that logic, it composes it.
     *
     * Broadcasts once the transaction commits (never before — a broadcast
     * for a trip that then rolled back would show connected clients a trip
     * that doesn't actually exist).
     */
    async dispatchOrdersToDriver(
        companyId: string,
        dispatcherUserId: string,
        dto: DispatchOrdersDto
    ): Promise<Trip> {
        const driverRole = await this.usersService.getUserRole(
            dto.driverUserId,
            companyId
        );
        if (driverRole.role !== TeamRoleType.DRIVER) {
            throw new BadRequestAppException(
                "The selected user is not a driver on this team"
            );
        }

        const savedTrip = await this.withTransaction(undefined, async trx => {
            const trip = trx.getRepository(Trip).create({
                companyId,
                driverUserId: dto.driverUserId,
                createdByUserId: dispatcherUserId
            });
            const trip_ = await trx.getRepository(Trip).save(trip);

            const stops: TripStop[] = [];
            for (let i = 0; i < dto.orderIds.length; i++) {
                const orderId = dto.orderIds[i];
                const order = await this.ordersService.getOrderByIdForCompany(
                    orderId,
                    companyId,
                    trx
                );

                if (order.status !== OrderStatus.PENDING) {
                    throw new BadRequestAppException(
                        `Order ${order.orderReference} is no longer pending and can't be dispatched`
                    );
                }

                await this.ordersService.assignDriverForCompany(
                    orderId,
                    companyId,
                    dto.driverUserId,
                    trx
                );

                const stop = trx.getRepository(TripStop).create({
                    tripId: trip_.id,
                    orderId,
                    sequence: i + 1,
                    status: StopStatus.PENDING
                });
                stops.push(await trx.getRepository(TripStop).save(stop));
            }

            trip_.stops = stops;
            return trip_;
        });

        await this.trackingService.broadcastTripUpdate(savedTrip.id);

        return savedTrip;
    }

    async getTripForCompany(
        tripId: string,
        companyId: string,
        manager?: EntityManager
    ): Promise<Trip> {
        const repo = manager ? manager.getRepository(Trip) : this.tripRepo;
        const trip = await repo.findOne({
            where: { id: tripId },
            relations: { stops: { order: { items: true } } }
        });
        if (!trip) throw new ResourceNotFoundException("Trip", tripId);
        if (trip.companyId !== companyId) {
            throw new ForbiddenAppException(
                "This trip does not belong to your company"
            );
        }
        trip.stops.sort((a, b) => a.sequence - b.sequence);
        return trip;
    }

    async listTripsForCompany(companyId: string, query: ListTripsQueryDto) {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;

        const trips = await this.tripRepo.find({
            where: { companyId },
            relations: { stops: { order: true } },
            order: { createdAt: "DESC" }
        });

        let filtered = trips;

        if (query.search) {
            const q = query.search.toLowerCase();
            filtered = filtered.filter(trip =>
                trip.stops.some(
                    stop =>
                        // BUG FIX: same orderReference issue removed here.
                        stop.order.trackingNumber.toLowerCase().includes(q) ||
                        stop.order.customerName.toLowerCase().includes(q)
                )
            );
        }

        if (query.status) {
            filtered = filtered.filter(
                trip => deriveTripStatus(trip.stops) === query.status
            );
        }

        const total = filtered.length;
        const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

        return { trips: paged, total, page, pageSize };
    }

    /**
     * Driver has reached this stop and picked up the order. Walks the order
     * through ASSIGNED -> PICKED_UP -> IN_TRANSIT via OrdersService, then
     * marks the stop ARRIVED. Broadcasts after commit.
     */
    async arriveAtStop(
        tripId: string,
        stopId: string,
        companyId: string
    ): Promise<TripStop> {
        const savedStop = await this.withTransaction(undefined, async trx => {
            const { trip, stop } = await this.getStopForCompany(
                tripId,
                stopId,
                companyId,
                trx
            );

            if (stop.status !== StopStatus.PENDING) {
                throw new BadRequestAppException(
                    `This stop is already ${stop.status}`
                );
            }

            await this.advanceOrderTo(
                stop.orderId,
                companyId,
                OrderStatus.IN_TRANSIT,
                trx
            );

            if (!trip.startedAt) {
                trip.startedAt = new Date();
                await trx.getRepository(Trip).save(trip);
            }

            stop.status = StopStatus.ARRIVED;
            stop.arrivedAt = new Date();
            return trx.getRepository(TripStop).save(stop);
        });

        await this.trackingService.broadcastTripUpdate(tripId);
        return savedStop;
    }

    /** Driver has delivered this stop's order. Order goes IN_TRANSIT -> DELIVERED. Broadcasts after commit. */
    async completeStop(
        tripId: string,
        stopId: string,
        companyId: string
    ): Promise<TripStop> {
        const savedStop = await this.withTransaction(undefined, async trx => {
            const { stop } = await this.getStopForCompany(
                tripId,
                stopId,
                companyId,
                trx
            );

            if (stop.status !== StopStatus.ARRIVED) {
                throw new BadRequestAppException(
                    "A stop must be arrived at before it can be completed"
                );
            }

            await this.advanceOrderTo(
                stop.orderId,
                companyId,
                OrderStatus.IN_TRANSIT,
                trx
            );
            await this.ordersService.updateOrderStatusForCompany(
                stop.orderId,
                companyId,
                { status: OrderStatus.DELIVERED },
                trx
            );

            stop.status = StopStatus.COMPLETED;
            stop.completedAt = new Date();
            return trx.getRepository(TripStop).save(stop);
        });

        await this.trackingService.broadcastTripUpdate(tripId);
        return savedStop;
    }

    /**
     * Driver couldn't complete this stop. The order becomes FAILED and the
     * trip continues to its next stop. Broadcasts after commit.
     */
    async skipStop(
        tripId: string,
        stopId: string,
        companyId: string,
        dto: SkipStopDto
    ): Promise<TripStop> {
        const savedStop = await this.withTransaction(undefined, async trx => {
            const { stop } = await this.getStopForCompany(
                tripId,
                stopId,
                companyId,
                trx
            );

            if (
                stop.status === StopStatus.COMPLETED ||
                stop.status === StopStatus.SKIPPED
            ) {
                throw new BadRequestAppException(
                    `This stop is already ${stop.status}`
                );
            }

            await this.advanceOrderTo(
                stop.orderId,
                companyId,
                OrderStatus.IN_TRANSIT,
                trx
            );
            await this.ordersService.updateOrderStatusForCompany(
                stop.orderId,
                companyId,
                { status: OrderStatus.FAILED },
                trx
            );

            stop.status = StopStatus.SKIPPED;
            stop.skipReason = dto.reason;
            stop.skipNote = dto.note ?? null;
            return trx.getRepository(TripStop).save(stop);
        });

        await this.trackingService.broadcastTripUpdate(tripId);
        return savedStop;
    }

    toTripResponse(trip: Trip) {
        return {
            id: trip.id,
            driverUserId: trip.driverUserId,
            createdAt: trip.createdAt,
            startedAt: trip.startedAt,
            status: deriveTripStatus(trip.stops),
            progress: getTripProgress(trip.stops),
            currentStop: getCurrentStop(trip.stops),
            stops: trip.stops.map(stop => ({
                id: stop.id,
                sequence: stop.sequence,
                orderId: stop.orderId,
                // BUG FIX: orderReference removed — not a real field.
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
                skipNote: stop.skipNote
            }))
        };
    }

    private async withTransaction<T>(
        manager: EntityManager | undefined,
        work: (manager: EntityManager) => Promise<T>
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
        manager: EntityManager
    ): Promise<{ trip: Trip; stop: TripStop }> {
        const trip = await manager
            .getRepository(Trip)
            .findOne({ where: { id: tripId } });
        if (!trip) throw new ResourceNotFoundException("Trip", tripId);
        if (trip.companyId !== companyId) {
            throw new ForbiddenAppException(
                "This trip does not belong to your company"
            );
        }

        const stop = await manager
            .getRepository(TripStop)
            .findOne({ where: { id: stopId, tripId } });
        if (!stop) throw new ResourceNotFoundException("TripStop", stopId);

        return { trip, stop };
    }

    private async advanceOrderTo(
        orderId: string,
        companyId: string,
        target: OrderStatus,
        manager: EntityManager
    ): Promise<void> {
        const order = await this.ordersService.getOrderByIdForCompany(
            orderId,
            companyId,
            manager
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
                manager
            );
        }
    }
}
