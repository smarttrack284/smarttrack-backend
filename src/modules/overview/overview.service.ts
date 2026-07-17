import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '#/common/entities/order.entity';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { Company } from '#/common/entities/company.entity';
import { StopStatus } from '#/common/constants/stop-status.constant';
import {
  ORDER_EVENTS,
  OrderCreatedEvent,
  OrderDeletedEvent,
  OrderStatusChangedEvent,
} from '#/common/events/order.events';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import { startOfTodayInTimezone } from '#/common/utils/timezone-date.util';
import { OrdersService } from '#/modules/orders/orders.service';
import { OverviewEmitterService } from './overview-emitter.service';

const KPI_TTL_SECONDS = 30;
const ACTIVITY_TTL_SECONDS = 20;
const RECENT_ORDERS_TTL_SECONDS = 20;

type ActivityEvent = { id: string; message: string; timestamp: string };

@Injectable()
export class OverviewService {
  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(TripStop)
    private readonly tripStopRepo: Repository<TripStop>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    private readonly cache: RedisCacheService,
    private readonly ordersService: OrdersService,
    private readonly emitter: OverviewEmitterService,
  ) {}

  async getKpis(companyId: string) {
    return this.cache.getOrSet(
      `overview:kpis:${companyId}`,
      KPI_TTL_SECONDS,
      () => this.computeKpis(companyId),
    );
  }

  async getRecentActivity(companyId: string) {
    return this.cache.getOrSet(
      `overview:activity:${companyId}`,
      ACTIVITY_TTL_SECONDS,
      () => this.computeRecentActivity(companyId),
    );
  }

  /** Deliberately reuses OrdersService.listOrdersForCompany — no new query for something already built. */
  async getRecentOrders(companyId: string) {
    return this.cache.getOrSet(
      `overview:recent-orders:${companyId}`,
      RECENT_ORDERS_TTL_SECONDS,
      () =>
        this.ordersService.listOrdersForCompany(companyId, {
          page: 1,
          pageSize: 5,
        }),
    );
  }

  /**
   * The invalidation + realtime side. Fires on every order create/status
   * change/delete, REGARDLESS of which service triggered it — OrdersService
   * and (transitively, since DispatchService routes through it)
   * DispatchService both land here with zero direct coupling to Overview.
   */
  @OnEvent(ORDER_EVENTS.CREATED)
  async handleOrderCreated(event: OrderCreatedEvent) {
    await this.refreshAndBroadcast(event.companyId);
  }

  @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent) {
    await this.refreshAndBroadcast(event.companyId);
  }

  @OnEvent(ORDER_EVENTS.DELETED)
  async handleOrderDeleted(event: OrderDeletedEvent) {
    await this.refreshAndBroadcast(event.companyId);
  }

  private async computeKpis(companyId: string) {
    const company = await this.companyRepo.findOne({
      where: { id: companyId },
    });
    const startOfToday = startOfTodayInTimezone(company?.timezone ?? 'UTC');
    return this.ordersService.getKpiCountsForCompany(companyId, startOfToday);
  }

  private async computeRecentActivity(
    companyId: string,
  ): Promise<ActivityEvent[]> {
    const recentOrders = await this.orderRepo.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const recentStops = await this.tripStopRepo
      .createQueryBuilder('stop')
      .innerJoinAndSelect('stop.order', 'order')
      .innerJoin('stop.trip', 'trip')
      .where('trip.companyId = :companyId', { companyId })
      .andWhere("stop.status != 'pending'")
      .orderBy('stop.updatedAt', 'DESC')
      .take(10)
      .getMany();

    const events: ActivityEvent[] = [];

    for (const order of recentOrders) {
      events.push({
        id: `order-created-${order.id}`,
        message: `Order ${order.orderReference} created for ${order.customerName}`,
        timestamp: order.createdAt.toISOString(),
      });
    }

    for (const stop of recentStops) {
      const label =
        stop.status === StopStatus.COMPLETED
          ? `Order ${stop.order.orderReference} delivered to ${stop.order.customerName}`
          : stop.status === StopStatus.ARRIVED
            ? `Driver arrived for order ${stop.order.orderReference}`
            : `Order ${stop.order.orderReference} skipped — ${stop.skipReason ?? 'no reason given'}`;

      events.push({
        id: `stop-${stop.status}-${stop.id}`,
        message: label,
        timestamp: (
          stop.completedAt ??
          stop.arrivedAt ??
          stop.updatedAt
        ).toISOString(),
      });
    }

    return events
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, 10);
  }

  private async refreshAndBroadcast(companyId: string): Promise<void> {
    await this.cache.del(
      `overview:kpis:${companyId}`,
      `overview:activity:${companyId}`,
      `overview:recent-orders:${companyId}`,
    );

    const [kpis, activity, recentOrders] = await Promise.all([
      this.getKpis(companyId),
      this.getRecentActivity(companyId),
      this.getRecentOrders(companyId),
    ]);

    this.emitter.emitToCompany(companyId, 'overview:update', {
      kpis,
      activity,
      recentOrders,
    });
  }
}
