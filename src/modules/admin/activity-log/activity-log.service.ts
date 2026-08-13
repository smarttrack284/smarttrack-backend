import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ActivityLog } from '#/common/entities/activity-log.entity';
import { Company } from '#/common/entities/company.entity';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import {
  ErrorHandlerService,
  rule,
} from '#/common/errors/error-handler.service';
import { InternalErrorException } from '#/common/exceptions';
import { QueryFailedError } from 'typeorm';
import { ListActivityLogAdminDto } from './dto/list-activity-log-admin.dto';

@Injectable()
export class AdminActivityLogService {
  private readonly logger = new Logger(AdminActivityLogService.name);
  private readonly CACHE_TTL_SECONDS = 60;

  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityLogRepo: Repository<ActivityLog>,
    private readonly cache: RedisCacheService,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  async listActivityLog(dto: ListActivityLogAdminDto) {
    const cacheKey = this.buildCacheKey(dto);

    try {
      return await this.cache.getOrSet(cacheKey, this.CACHE_TTL_SECONDS, () =>
        this.queryActivityLog(dto),
      );
    } catch (err) {
      this.errorHandler.handle(err, 'AdminActivityLogService.listActivityLog', [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to load activity log. Please try again.',
          ),
        ),
        rule(Error, () =>
          new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          ),
        ),
      ]);
    }
  }

  private async queryActivityLog(dto: ListActivityLogAdminDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const qb = this.activityLogRepo
      .createQueryBuilder('log')
      .leftJoin(Company, 'company', 'company.id = log.companyId')
      .addSelect([
        'log.id',
        'log.companyId',
        'log.category',
        'log.eventType',
        'log.severity',
        'log.message',
        'log.actorName',
        'log.createdAt',
      ])
      .addSelect('company.name', 'companyName');

    // Filters
    if (dto.companyId) {
      qb.andWhere('log.companyId = :companyId', { companyId: dto.companyId });
    }

    if (dto.categories?.length) {
      qb.andWhere('log.category IN (:...categories)', {
        categories: dto.categories,
      });
    }

    if (dto.severities?.length) {
      qb.andWhere('log.severity IN (:...severities)', {
        severities: dto.severities,
      });
    }

    if (dto.search) {
      qb.andWhere(
        new Brackets((sqb) => {
          sqb.where('log.message ILIKE :search', {
            search: `%${dto.search}%`,
          });
        }),
      );
    }

    if (dto.dateFrom) {
      qb.andWhere('log.createdAt >= :dateFrom', {
        dateFrom: new Date(dto.dateFrom),
      });
    }

    if (dto.dateTo) {
      const endOfDay = new Date(dto.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      qb.andWhere('log.createdAt <= :dateTo', { dateTo: endOfDay });
    }

    qb.orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const rawRows = await qb.getRawMany<{
      log_id: string;
      log_companyId: string;
      companyName: string | null;
      log_category: string;
      log_eventType: string;
      log_severity: string;
      log_message: string;
      log_actorName: string | null;
      log_createdAt: Date;
    }>();

    const total = await qb.getCount();

    const events = rawRows.map((row) => ({
      id: row.log_id,
      companyId: row.log_companyId,
      companyName: row.companyName ?? 'Unknown',
      category: row.log_category,
      eventType: row.log_eventType,
      severity: row.log_severity,
      message: row.log_message,
      actorName: row.log_actorName ?? null,
      createdAt: row.log_createdAt,
    }));

    return {
      events,
      total,
      page,
      pageSize,
    };
  }

  private buildCacheKey(dto: ListActivityLogAdminDto): string {
    const parts = [
      dto.companyId ?? '',
      (dto.categories ?? []).join(','),
      (dto.severities ?? []).join(','),
      dto.search ?? '',
      dto.dateFrom ?? '',
      dto.dateTo ?? '',
      dto.page ?? 1,
      dto.pageSize ?? 20,
    ];
    return `admin:activity-log:list:${parts.join('|')}`;
  }
}