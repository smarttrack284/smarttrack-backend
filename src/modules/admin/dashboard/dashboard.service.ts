import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '#/common/entities/company.entity';
import { Subscription } from '#/common/entities/subscription.entity';
import { UserRole } from '#/common/entities/user-role.entity';
import { Order } from '#/common/entities/order.entity';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import {
  ErrorHandlerService,
  rule,
} from '#/common/errors/error-handler.service';
import { InternalErrorException } from '#/common/exceptions';
import { QueryFailedError } from 'typeorm';

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);
  private readonly CACHE_TTL_SECONDS = 60;

  constructor(
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly cache: RedisCacheService,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  async getStats() {
    const cacheKey = 'admin:dashboard:stats';

    try {
      return await this.cache.getOrSet(cacheKey, this.CACHE_TTL_SECONDS, () =>
        this.computeStats(),
      );
    } catch (err) {
      this.errorHandler.handle(err, 'AdminDashboardService.getStats', [
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to load dashboard stats. Please try again.',
            ),
        ),
        rule(
          Error,
          () =>
            new InternalErrorException(
              'An unexpected error occurred. Please try again later.',
            ),
        ),
      ]);
    }
  }

  private async computeStats() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfSevenDays = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalCompanies,
      totalUsers,
      totalOrders,
      ordersToday,
      recentSignups,
      subscriptionBreakdownRows,
    ] = await Promise.all([
      this.companyRepo.count(),
      this.userRoleRepo.count(),
      this.orderRepo.count(),
      this.orderRepo
        .createQueryBuilder('order')
        .where('order.createdAt >= :startOfToday', { startOfToday })
        .getCount(),
      this.companyRepo
        .createQueryBuilder('company')
        .where('company.createdAt >= :startOfSevenDays', { startOfSevenDays })
        .getCount(),
      this.subscriptionRepo
        .createQueryBuilder('subscription')
        .select('subscription.plan', 'plan')
        .addSelect('COUNT(*)', 'count')
        .groupBy('subscription.plan')
        .getRawMany<{ plan: string; count: string }>(),
    ]);

    const subscriptionBreakdown = {
      free: 0,
      starter: 0,
      pro: 0,
    };

    for (const row of subscriptionBreakdownRows) {
      if (row.plan === 'free') subscriptionBreakdown.free = Number(row.count);
      if (row.plan === 'starter')
        subscriptionBreakdown.starter = Number(row.count);
      if (row.plan === 'pro') subscriptionBreakdown.pro = Number(row.count);
    }

    const response = {
      totalCompanies,
      totalUsers,
      totalOrders,
      ordersToday,
      recentSignups,
      subscriptionBreakdown,
    };

    this.logger.log({
      msg: 'Loaded admin dashboard stats',
      ...response,
    });

    return response;
  }
}
