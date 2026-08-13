import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { Order } from "#/common/entities/order.entity";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { Company } from "#/common/entities/company.entity";
import { StopStatus } from "#/common/constants/stop-status.constant";
import {
    ORDER_EVENTS,
    OrderCreatedEvent,
    OrderDeletedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { startOfTodayInTimezone } from "#/common/utils/timezone-date.util";
import { OrdersService } from "#/modules/orders/orders.service";
import { OverviewEmitterService } from "./overview-emitter.service";
import { ActivityLogService } from "#/modules/activity-log/activity-log.service";
import {
    OrderPriority,
    OrderStatus
} from "#/common/constants/order-status.constant";
import { TeamRoleType } from "#/common/types/team-role.type";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";
import { UserRole } from "#/common/entities/user-role.entity";
import { ListActivityLogQueryDto } from "#/modules/activity-log/dto/list-activity-log.query.dto";
import { ListOrdersQueryDto } from "#/modules/orders/dto/list-orders.query.dto";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { PlanGuard,CachedSubscription } from "#/common/guards/plan.guard";

type ActivityEvent = { id: string; message: string; timestamp: string };


@Injectable()
export class OverviewService {
    private readonly KPI_TTL_SECONDS = 30;
    private readonly ACTIVITY_TTL_SECONDS = 20;
    private readonly RECENT_ORDERS_TTL_SECONDS = 20;
    private readonly SLA_PENDING_HOURS = 2;

    constructor(
        @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
        @InjectRepository(TripStop)
        private readonly tripStopRepo: Repository<TripStop>,
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        private readonly cache: RedisCacheService,
        private readonly ordersService: OrdersService,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly emitter: OverviewEmitterService,
        private readonly activityLogService: ActivityLogService
    ) {}

    async getKpis(companyId: string) {
        return this.cache.getOrSet(
            `overview:kpis:${companyId}`,
            this.KPI_TTL_SECONDS,
            () => this.computeKpis(companyId)
        );
    }

    async getAdvancedKpis(companyId: string) {
        return this.cache.getOrSet(
            `overview:advanced-kpis:${companyId}`,
            30,
            () => this.computeAdvancedKpis(companyId)
        );
    }

    async getAdvancedRecentOrders(
        companyId: string,
        query: ListOrdersQueryDto
    ) {
        const result = await this.ordersService.listOrdersForCompanyCached(
            companyId,
            query
        );

        const orderIds = result.orders.map(o => o.id);
        const etaByOrderId = await this.getEtaByOrderIds(orderIds);

        return {
            ...result,
            orders: result.orders.map(order => ({
                ...order,
                etaMinutes: etaByOrderId.get(order.id) ?? null
            }))
        };
    }

    async getAdvancedActivity(
        companyId: string,
        query: ListActivityLogQueryDto
    ) {
        return this.activityLogService.listForCompany(companyId, query);
    }

    async getRecentActivity(companyId: string) {
        return this.cache.getOrSet(
            `overview:activity:${companyId}`,
            this.ACTIVITY_TTL_SECONDS,
            () => this.computeRecentActivity(companyId)
        );
    }

    async getRecentOrders(companyId: string) {
        return this.cache.getOrSet(
            `overview:recent-orders:${companyId}`,
            this.RECENT_ORDERS_TTL_SECONDS,
            () =>
                this.ordersService.listOrdersForCompany(companyId, {
                    page: 1,
                    pageSize: 5
                })
        );
    }

    // ── Order event handlers (unchanged) ──
    @OnEvent(ORDER_EVENTS.CREATED)
    async handleOrderCreated(event: OrderCreatedEvent) {
        await this.refreshAndBroadcast(event.payload.companyId);
    }

    @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
    async handleOrderStatusChanged(event: OrderStatusChangedEvent) {
        await this.refreshAndBroadcast(event.payload.companyId);
    }

    @OnEvent(ORDER_EVENTS.DELETED)
    async handleOrderDeleted(event: OrderDeletedEvent) {
        await this.refreshAndBroadcast(event.payload.companyId);
    }

    // ── Private compute methods (unchanged) ──
    private async computeKpis(companyId: string) {
        const company = await this.companyRepo.findOne({
            where: { id: companyId }
        });
        const startOfToday = startOfTodayInTimezone(company?.timezone ?? "UTC");
        return this.ordersService.getKpiCountsForCompany(
            companyId,
            startOfToday
        );
    }

    private async computeAdvancedKpis(companyId: string) {
        const company = await this.companyRepo.findOne({
            where: { id: companyId }
        });
        const timezone = company?.timezone ?? "UTC";
        const startOfToday = startOfTodayInTimezone(timezone);
        const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);

        const [
            basic,
            yesterdayCounts,
            priorityRaw,
            slaBreaches,
            driverStats,
            avgDelivery7d,
            onTimeRate7d
        ] = await Promise.all([
            this.ordersService.getKpiCountsForCompany(companyId, startOfToday),
            this.getCountsForRange(companyId, startOfYesterday, startOfToday),
            this.orderRepo
                .createQueryBuilder("order")
                .select("order.priority", "priority")
                .addSelect("COUNT(*)", "count")
                .where("order.companyId = :companyId", { companyId })
                .andWhere(
                    `order.status NOT IN ('delivered', 'cancelled', 'failed')`
                )
                .groupBy("order.priority")
                .getRawMany<{ priority: OrderPriority; count: string }>(),
            this.orderRepo.count({
                where: {
                    companyId,
                    status: OrderStatus.PENDING,
                    createdAt: LessThan(
                        new Date(
                            Date.now() - this.SLA_PENDING_HOURS * 3_600_000
                        )
                    )
                }
            }),
            this.computeDriverUtilization(companyId),
            this.computeAvgDeliveryMinutesSince(
                companyId,
                new Date(Date.now() - 7 * 86_400_000)
            ),
            this.computeOnTimeRateSince(
                companyId,
                new Date(Date.now() - 7 * 86_400_000)
            )
        ]);

        const priorityBreakdown = { low: 0, normal: 0, high: 0, urgent: 0 };
        for (const row of priorityRaw)
            priorityBreakdown[row.priority] = Number(row.count);

        function percentChange(
            today: number,
            yesterday: number
        ): number | null {
            if (yesterday === 0) return today > 0 ? 100 : null;
            return Math.round(((today - yesterday) / yesterday) * 100);
        }

        return {
            ...basic,
            ordersTodayChangePercent: percentChange(
                basic.ordersToday,
                yesterdayCounts.ordersToday
            ),
            completedTodayChangePercent: percentChange(
                basic.completedToday,
                yesterdayCounts.completedToday
            ),
            priorityBreakdown,
            slaBreaches,
            driverUtilization: driverStats,
            avgDelivery7d,
            onTimeRate7d
        };
    }

    private async computeDriverUtilization(companyId: string) {
        const totalDrivers = await this.userRoleRepo.count({
            where: {
                companyId,
                role: TeamRoleType.DRIVER,
                status: TeamMemberStatus.ACTIVE
            }
        });
        if (totalDrivers === 0)
            return { activeDrivers: 0, totalDrivers: 0, percent: 0 };

        const busyRaw = await this.tripStopRepo
            .createQueryBuilder("stop")
            .innerJoin("stop.trip", "trip")
            .select("COUNT(DISTINCT trip.driverUserId)", "count")
            .where("trip.companyId = :companyId", { companyId })
            .andWhere("stop.status IN (:...statuses)", {
                statuses: [StopStatus.PENDING, StopStatus.ARRIVED]
            })
            .getRawOne<{ count: string }>();

        const activeDrivers = Number(busyRaw?.count);
        return {
            activeDrivers,
            totalDrivers,
            percent: Math.round((activeDrivers / totalDrivers) * 100)
        };
    }

    private async getEtaByOrderIds(
        orderIds: string[]
    ): Promise<Map<string, number | null>> {
        if (orderIds.length === 0) return new Map();

        const stops = await this.tripStopRepo
            .createQueryBuilder("stop")
            .innerJoin("stop.trip", "trip")
            .select("stop.orderId", "orderId")
            .addSelect("trip.etaMinutes", "etaMinutes")
            .where("stop.orderId IN (:...orderIds)", { orderIds })
            .andWhere("stop.status IN (:...statuses)", {
                statuses: [StopStatus.PENDING, StopStatus.ARRIVED]
            })
            .getRawMany<{ orderId: string; etaMinutes: number | null }>();

        return new Map(stops.map(s => [s.orderId, s.etaMinutes]));
    }

    private async computeAvgDeliveryMinutesSince(
        companyId: string,
        since: Date
    ): Promise<number> {
        const raw = await this.tripStopRepo
            .createQueryBuilder("stop")
            .innerJoin("stop.trip", "trip")
            .select(
                "AVG(EXTRACT(EPOCH FROM (stop.completedAt - stop.arrivedAt)) / 60)",
                "avgMinutes"
            )
            .where("trip.companyId = :companyId", { companyId })
            .andWhere("stop.status = :status", { status: StopStatus.COMPLETED })
            .andWhere("stop.arrivedAt IS NOT NULL")
            .andWhere("stop.completedAt >= :since", { since })
            .getRawOne();
        return raw?.avgMinutes ? Math.round(Number(raw.avgMinutes)) : 0;
    }

    private async computeOnTimeRateSince(
        companyId: string,
        since: Date
    ): Promise<number | null> {
        const raw = await this.orderRepo
            .createQueryBuilder("order")
            .select("COUNT(*)", "total")
            .addSelect(
                `COUNT(*) FILTER (WHERE order.updatedAt <= order.scheduledFor)`,
                "onTime"
            )
            .where("order.companyId = :companyId", { companyId })
            .andWhere("order.status = :status", {
                status: OrderStatus.DELIVERED
            })
            .andWhere("order.scheduledFor IS NOT NULL")
            .andWhere("order.updatedAt >= :since", { since })
            .getRawOne();

        const total = Number(raw.total);
        if (total === 0) return null;
        return Math.round((Number(raw.onTime) / total) * 100);
    }

    private async getCountsForRange(companyId: string, from: Date, to: Date) {
        const raw = await this.orderRepo
            .createQueryBuilder("order")
            .select(
                "COUNT(*) FILTER (WHERE order.createdAt >= :from AND order.createdAt < :to)",
                "ordersToday"
            )
            .addSelect(
                `COUNT(*) FILTER (WHERE order.status = 'delivered' AND order.updatedAt >= :from AND order.updatedAt < :to)`,
                "completedToday"
            )
            .where("order.companyId = :companyId", { companyId, from, to })
            .getRawOne();
        return {
            ordersToday: Number(raw.ordersToday),
            completedToday: Number(raw.completedToday)
        };
    }

    private async computeRecentActivity(
        companyId: string
    ): Promise<ActivityEvent[]> {
        const recentOrders = await this.orderRepo.find({
            where: { companyId },
            order: { createdAt: "DESC" },
            take: 10
        });

        const recentStops = await this.tripStopRepo
            .createQueryBuilder("stop")
            .innerJoinAndSelect("stop.order", "order")
            .innerJoin("stop.trip", "trip")
            .where("trip.companyId = :companyId", { companyId })
            .andWhere("stop.status != 'pending'")
            .orderBy("stop.updatedAt", "DESC")
            .take(10)
            .getMany();

        const events: ActivityEvent[] = [];

        for (const order of recentOrders) {
            events.push({
                id: `order-created-${order.id}`,
                message: `Order #${order.orderReference} created for ${order.customerName}`,
                timestamp: order.createdAt.toISOString()
            });
        }

        for (const stop of recentStops) {
            const label =
                stop.status === StopStatus.COMPLETED
                    ? `Order ${stop.order.orderReference} delivered to ${stop.order.customerName}`
                    : stop.status === StopStatus.ARRIVED
                    ? `Driver arrived for order ${stop.order.orderReference}`
                    : `Order ${stop.order.orderReference} skipped — ${
                          stop.skipReason ?? "no reason given"
                      }`;

            events.push({
                id: `stop-${stop.status}-${stop.id}`,
                message: label,
                timestamp: (
                    stop.completedAt ??
                    stop.arrivedAt ??
                    stop.updatedAt
                ).toISOString()
            });
        }

        return events
            .sort(
                (a, b) =>
                    new Date(b.timestamp).getTime() -
                    new Date(a.timestamp).getTime()
            )
            .slice(0, 10);
    }

    private async refreshAndBroadcast(companyId: string): Promise<void> {
        // Invalidate all overview caches (basic and advanced)
        await this.cache.del(
            `overview:kpis:${companyId}`,
            `overview:activity:${companyId}`,
            `overview:recent-orders:${companyId}`,
            `overview:advanced-kpis:${companyId}`,
            `overview:recent-orders:${companyId}:advanced`,
            `overview:activity:${companyId}:advanced`
        );

        // Reuse the PlanGuard cache key to get the subscription plan
        const plan = await this.getPlanFromGuardCache(companyId);

        const [kpis, activity, recentOrders] = await Promise.all([
            this.getKpis(companyId),
            this.getRecentActivity(companyId),
            this.getRecentOrders(companyId)
        ]);

        let payload: any = { kpis, activity, recentOrders };

        if (plan === SubscriptionPlan.PRO) {
            const [advancedKpis, advancedRecentOrders, advancedActivity] =
                await Promise.all([
                    this.getAdvancedKpis(companyId),
                    this.getAdvancedRecentOrders(companyId, {
                        page: 1,
                        pageSize: 5
                    }),
                    this.getAdvancedActivity(companyId, {
                        page: 1,
                        pageSize: 5
                    })
                ]);
            payload.advanced = {
                kpis: advancedKpis,
                recentOrders: advancedRecentOrders,
                activity: advancedActivity
            };
        }

        this.emitter.emitToCompany(companyId, "overview:update", payload);
    }

    /**
     * Reads the subscription from the shared PlanGuard cache. If not present,
     * fetch it from the DB and populate the same cache key.
     */
    private async getPlanFromGuardCache(
        companyId: string
    ): Promise<SubscriptionPlan> {
        const cacheKey = PlanGuard.subscriptionKey(companyId);
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached) as CachedSubscription;
                return parsed.plan as SubscriptionPlan;
            } catch {
                // fall through – cache may be malformed
            }
        }

        // Fetch from DB and store in the same cache key
        const sub =
            await this.subscriptionsService.getSubscriptionByCompanyId(
                companyId
            );
        const plan = sub?.plan ?? SubscriptionPlan.FREE;
        const cachedSub: CachedSubscription = {
            plan: sub?.plan ?? SubscriptionPlan.FREE,
            status: sub?.status ?? "inactive",
            currentPeriodEnd: sub?.currentPeriodEnd ?? null,
            companyId
        };
        await this.cache.set(
            cacheKey,
            JSON.stringify(cachedSub),
            PlanGuard.SUBSCRIPTION_TTL
        );
        return plan;
    }
}
