import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Company } from '#/common/entities/company.entity';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import {
  ErrorHandlerService,
  rule,
} from '#/common/errors/error-handler.service';
import {
  InternalErrorException,
  ResourceNotFoundException,
} from '#/common/exceptions';
import { QueryFailedError } from 'typeorm';
import { ListCompanyTripsDto, TripSort } from './dto/list-company-trips.dto';

@Injectable()
export class AdminTripsService {
  private readonly logger = new Logger(AdminTripsService.name);
  private readonly CACHE_TTL_SECONDS = 60;

  constructor(
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly cache: RedisCacheService,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  async listTrips(companyId: string, dto: ListCompanyTripsDto) {
    const cacheKey = `admin:companies:${companyId}:trips:${this.buildCacheKey(dto)}`;

    try {
      return await this.cache.getOrSet(cacheKey, this.CACHE_TTL_SECONDS, () =>
        this.queryTrips(companyId, dto),
      );
    } catch (err) {
      this.errorHandler.handle(err, 'AdminTripsService.listTrips', [
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to list trips. Please try again.',
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

  private async queryTrips(companyId: string, dto: ListCompanyTripsDto) {
    const company = await this.companyRepo.findOne({
      where: { id: companyId },
    });
    if (!company) {
      throw new ResourceNotFoundException('Company not found');
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const limit = pageSize;

    // Build dynamic WHERE conditions and parameters
    const conditions: string[] = ['t.company_id = ?'];
    const params: any[] = [companyId];

    if (dto.search) {
      conditions.push(`(
        t.trip_reference ILIKE ?
        OR EXISTS (
          SELECT 1 FROM trip_stops ts
          INNER JOIN orders o ON o.id = ts.order_id
          WHERE ts.trip_id = t.id AND o.customer_name ILIKE ?
        )
      )`);
      params.push(`%${dto.search}%`, `%${dto.search}%`);
    }

    if (dto.driverUserId) {
      conditions.push('t.driver_user_id = ?');
      params.push(dto.driverUserId);
    }

    if (dto.dateFrom) {
      conditions.push('t.created_at >= ?');
      params.push(new Date(dto.dateFrom));
    }

    if (dto.dateTo) {
      const endOfDay = new Date(dto.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push('t.created_at <= ?');
      params.push(endOfDay);
    }

    const whereClause = conditions.join(' AND ');

    const derivedStatusExpression = `
      CASE
        WHEN COUNT(s.id) = 0 THEN 'pending'
        WHEN COUNT(s.id) = COUNT(s.id) FILTER (WHERE s.status = 'completed') THEN 'completed'
        WHEN COUNT(s.id) FILTER (WHERE s.status IN ('pending', 'arrived')) > 0 THEN 'in_transit'
        WHEN COUNT(s.id) = COUNT(s.id) FILTER (WHERE s.status = 'skipped') THEN 'skipped'
        WHEN COUNT(s.id) FILTER (WHERE s.status = 'failed') > 0 THEN 'failed'
        ELSE 'pending'
      END
    `;

    // Main query
    const mainQuery = `
      SELECT *
      FROM (
        SELECT
          t.id,
          t.trip_reference,
          t.driver_user_id,
          t.created_at,
          t.started_at,
          COUNT(s.id) AS total_stops,
          COUNT(s.id) FILTER (WHERE s.status = 'completed') AS completed_stops,
          ${derivedStatusExpression} AS derived_status,
          driver.name AS driver_name
        FROM trips t
        LEFT JOIN trip_stops s ON s.trip_id = t.id
        LEFT JOIN user_roles driver
          ON driver.user_id = t.driver_user_id
          AND driver.company_id = t.company_id
          AND driver.role = 'driver'
        WHERE ${whereClause}
        GROUP BY t.id, driver.name
      ) AS trip_data
      ${dto.status ? 'WHERE derived_status = ?' : ''}
      ORDER BY created_at ${dto.sort === TripSort.OLDEST ? 'ASC' : 'DESC'}
      LIMIT ? OFFSET ?
    `;

    // Add status param if present
    const finalParams = [...params];
    if (dto.status) {
      finalParams.push(dto.status);
    }
    finalParams.push(limit, offset);

    const trips = await this.dataSource.query(mainQuery, finalParams);

    // Count query
    const countQuery = `
      SELECT COUNT(*) FROM (
        SELECT
          t.id,
          ${derivedStatusExpression} AS derived_status
        FROM trips t
        LEFT JOIN trip_stops s ON s.trip_id = t.id
        LEFT JOIN user_roles driver
          ON driver.user_id = t.driver_user_id
          AND driver.company_id = t.company_id
          AND driver.role = 'driver'
        WHERE ${whereClause}
        GROUP BY t.id, driver.name
      ) AS trip_data
      ${dto.status ? 'WHERE derived_status = ?' : ''}
    `;

    const countParams = [...params];
    if (dto.status) {
      countParams.push(dto.status);
    }

    const countResult = await this.dataSource.query(countQuery, countParams);
    const total = Number(countResult[0].count);

    return {
      company: {
        id: company.id,
        name: company.name,
      },
      trips: trips.map((t: any) => ({
        id: t.id,
        tripReference: t.trip_reference,
        driverUserId: t.driver_user_id,
        driverName: t.driver_name ?? 'Unknown',
        status: t.derived_status,
        totalStops: Number(t.total_stops) || 0,
        completedStops: Number(t.completed_stops) || 0,
        createdAt: t.created_at,
        startedAt: t.started_at,
      })),
      total,
      page,
      pageSize,
    };
  }

  private buildCacheKey(dto: ListCompanyTripsDto): string {
    const parts = [
      dto.search ?? '',
      dto.status ?? '',
      dto.driverUserId ?? '',
      dto.dateFrom ?? '',
      dto.dateTo ?? '',
      dto.sort ?? TripSort.NEWEST,
      dto.page ?? 1,
      dto.pageSize ?? 20,
    ];
    return parts.join('|');
  }
}
