import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Order } from "#/common/entities/order.entity";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { Company } from "#/common/entities/company.entity";
import { OrderStatus } from "#/common/constants/order-status.constant";
import { StopStatus } from "#/common/constants/stop-status.constant";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { UsersService } from "#/modules/users/users.service";
import { AnalyticsQueryDto } from "./dto/analytics-query.dto";

const ANALYTICS_TTL_SECONDS = 60; // analytics is inherently retrospective, not live — a full minute of staleness is a fine tradeoff for materially fewer expensive aggregate queries

@Injectable()
export class AnalyticsService {
    constructor(
        @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
        @InjectRepository(TripStop)
        private readonly tripStopRepo: Repository<TripStop>,
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        private readonly cache: RedisCacheService,
        private readonly usersService: UsersService
    ) {}

    async getAnalytics(companyId: string, query: AnalyticsQueryDto) {
        const range = this.resolveDateRange(query);
        const cacheKey = `analytics:${companyId}:${range.from.toISOString()}:${range.to.toISOString()}`;

        return this.cache.getOrSet(
            cacheKey,
            ANALYTICS_TTL_SECONDS,
            async () => {
                const [summary, trend, statusBreakdown, topDrivers] =
                    await Promise.all([
                        this.computeSummary(companyId, range),
                        this.computeTrend(companyId, range),
                        this.computeStatusBreakdown(companyId, range),
                        this.computeTopDrivers(companyId, range)
                    ]);
                return { summary, trend, statusBreakdown, topDrivers };
            }
        );
    }

    /** Defaults to the last 14 days if no range given — matches the frontend's AnalyticsToolbar default label ("Last 14 days"). */
    private resolveDateRange(query: AnalyticsQueryDto): {
        from: Date;
        to: Date;
    } {
        const to = query.dateTo ? new Date(query.dateTo) : new Date();
        const from = query.dateFrom
            ? new Date(query.dateFrom)
            : new Date(to.getTime() - 14 * 86_400_000);
        return { from, to };
    }

    private async computeSummary(
        companyId: string,
        range: { from: Date; to: Date }
    ) {
        const raw = await this.orderRepo
            .createQueryBuilder("order")
            .select("COUNT(*)", "totalOrders")
            .addSelect(
                `COUNT(*) FILTER (WHERE order.status = 'delivered')`,
                "deliveredCount"
            )
            .addSelect(
                `COUNT(*) FILTER (WHERE order.status = 'failed')`,
                "failedCount"
            )
            .where("order.companyId = :companyId", { companyId })
            .andWhere("order.createdAt BETWEEN :from AND :to", range)
            .getRawOne();

        const totalOrders = Number(raw.totalOrders);
        const deliveredCount = Number(raw.deliveredCount);
        const failedCount = Number(raw.failedCount);

        // Real duration, from actual timestamps — pickedUp -> delivered, not a
        // straight-line/guessed figure. Matches your earlier insistence on
        // real over estimated data for anything user-facing.
        const avgDeliveryMinutes = await this.computeAvgDeliveryMinutes(
            companyId,
            range
        );

        return {
            totalOrders,
            completionRate:
                totalOrders > 0 ? (deliveredCount / totalOrders) * 100 : 0,
            avgDeliveryMinutes,
            failedRate: totalOrders > 0 ? (failedCount / totalOrders) * 100 : 0
        };
    }

    private async computeAvgDeliveryMinutes(
        companyId: string,
        range: { from: Date; to: Date }
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
            .andWhere("stop.completedAt BETWEEN :from AND :to", range)
            .getRawOne();

        return raw?.avgMinutes ? Math.round(Number(raw.avgMinutes)) : 0;
    }

    private async computeTrend(
        companyId: string,
        range: { from: Date; to: Date }
    ) {
        const raw = await this.orderRepo
            .createQueryBuilder("order")
            .select(`DATE_TRUNC('day', order.createdAt)`, "date")
            .addSelect("COUNT(*)", "orders")
            .where("order.companyId = :companyId", { companyId })
            .andWhere("order.createdAt BETWEEN :from AND :to", range)
            .groupBy(`DATE_TRUNC('day', order.createdAt)`)
            .orderBy("date", "ASC")
            .getRawMany<{ date: Date; orders: string }>();

        return raw.map(row => ({
            date: row.date.toISOString(),
            orders: Number(row.orders)
        }));
    }

    private async computeStatusBreakdown(
        companyId: string,
        range: { from: Date; to: Date }
    ) {
        const raw = await this.orderRepo
            .createQueryBuilder("order")
            .select("order.status", "status")
            .addSelect("COUNT(*)", "count")
            .where("order.companyId = :companyId", { companyId })
            .andWhere("order.createdAt BETWEEN :from AND :to", range)
            .groupBy("order.status")
            .getRawMany<{ status: OrderStatus; count: string }>();

        const counts = new Map(raw.map(r => [r.status, Number(r.count)]));
        return Object.values(OrderStatus).map(status => ({
            status,
            count: counts.get(status) ?? 0
        }));
    }

    private async computeTopDrivers(
        companyId: string,
        range: { from: Date; to: Date }
    ) {
        const raw = await this.tripStopRepo
            .createQueryBuilder("stop")
            .innerJoin("stop.trip", "trip")
            .select("trip.driverUserId", "driverUserId")
            .addSelect("COUNT(*)", "deliveries")
            .where("trip.companyId = :companyId", { companyId })
            .andWhere("stop.status = :status", { status: StopStatus.COMPLETED })
            .andWhere("stop.completedAt BETWEEN :from AND :to", range)
            .groupBy("trip.driverUserId")
            .orderBy("deliveries", "DESC")
            .limit(5)
            .getRawMany<{ driverUserId: string; deliveries: string }>();

        // Driver names live in UserRole, not on Trip/TripStop — same "no
        // duplicated identity data" discipline used everywhere else in this
        // build. One extra lookup, not a join, since UserRole isn't related
        // to Trip at the entity level.
        const results = await Promise.all(
            raw.map(async row => {
                const driver = await this.usersService
                    .getUserRole(row.driverUserId, companyId)
                    .catch(() => null);
                return {
                    id: row.driverUserId,
                    name: driver?.name ?? "Unknown driver",
                    deliveries: Number(row.deliveries)
                };
            })
        );

        return results;
    }
}
