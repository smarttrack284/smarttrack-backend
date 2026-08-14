import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, QueryFailedError, Repository } from "typeorm";
import { AdminAuditLog } from "#/common/entities/admin-audit-log.entity";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import {
    ErrorHandlerService,
    rule
} from "#/common/errors/error-handler.service";
import { InternalErrorException } from "#/common/exceptions";
import { ListAdminAuditLogsDto } from "./dto/list-admin-audit-logs.dto";
import { UsersService } from "#/modules/users/users.service";

@Injectable()
export class AdminAuditLogService {
    private readonly logger = new Logger(AdminAuditLogService.name);
    private readonly CACHE_TTL_SECONDS = 60;

    constructor(
        @InjectRepository(AdminAuditLog)
        private readonly adminAuditLogRepo: Repository<AdminAuditLog>,
        private readonly cache: RedisCacheService,
        private readonly errorHandler: ErrorHandlerService,
        private readonly usersService: UsersService
    ) {}

    async listAuditLogs(dto: ListAdminAuditLogsDto) {
        const cacheKey = this.buildCacheKey(dto);

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.queryAuditLogs(dto)
            );
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminAuditLogService.listAuditLogs",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to list admin audit logs. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    /**
     * Records an admin audit log entry.
     * This method intentionally never throws – audit logging failures
     * should not break the main admin action.
     */
    async record(input: {
        adminUserId?: string | null;
        companyId?: string | null;
        action: string;
        severity?: string;
        message: string;
        metadata?: Record<string, unknown> | null;
    }): Promise<void> {
        try {
            const log = this.adminAuditLogRepo.create({
                adminUserId: input.adminUserId ?? null,
                companyId: input.companyId ?? null,
                action: input.action,
                severity: input.severity ?? "info",
                message: input.message,
                metadata: input.metadata ?? null
            });

            await this.adminAuditLogRepo.save(log);
        } catch (err) {
            this.logger.error({
                msg: "Failed to record admin audit log",
                err: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                input
            });
        }
    }

    private async queryAuditLogs(dto: ListAdminAuditLogsDto) {
        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 20;

        const qb = this.adminAuditLogRepo
            .createQueryBuilder("log")
            .addSelect([
                "log.id",
                "log.adminUserId",
                "log.companyId",
                "log.action",
                "log.severity",
                "log.message",
                "log.createdAt"
            ]);

        // Filters
        if (dto.adminUserId) {
            qb.andWhere("log.adminUserId = :adminUserId", {
                adminUserId: dto.adminUserId
            });
        }

        if (dto.companyId) {
            qb.andWhere("log.companyId = :companyId", {
                companyId: dto.companyId
            });
        }

        if (dto.action) {
            qb.andWhere("log.action = :action", { action: dto.action });
        }

        if (dto.severity) {
            qb.andWhere("log.severity = :severity", { severity: dto.severity });
        }

        if (dto.search) {
            qb.andWhere(
                new Brackets(sqb => {
                    sqb.where("log.message ILIKE :search", {
                        search: `%${dto.search}%`
                    }).orWhere("log.action ILIKE :search", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }

        if (dto.dateFrom) {
            qb.andWhere("log.createdAt >= :dateFrom", {
                dateFrom: new Date(dto.dateFrom)
            });
        }

        if (dto.dateTo) {
            const endOfDay = new Date(dto.dateTo);
            endOfDay.setHours(23, 59, 59, 999);
            qb.andWhere("log.createdAt <= :dateTo", { dateTo: endOfDay });
        }

        qb.orderBy("log.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const rawRows = await qb.getRawMany<{
            log_id: string;
            log_adminUserId: string | null;
            log_companyId: string | null;
            log_action: string;
            log_severity: string;
            log_message: string;
            log_createdAt: Date;
        }>();

        // Collect unique admin user IDs
        const adminUserIds = [
            ...new Set(
                rawRows
                    .map(row => row.log_adminUserId)
                    .filter((id): id is string => !!id)
            )
        ];

        // Fetch admin details in parallel with fallback
        const adminDetailsMap = new Map<
            string,
            { name: string; email: string }
        >();

        if (adminUserIds.length > 0) {
            await Promise.all(
                adminUserIds.map(async adminUserId => {
                    try {
                        const user =
                            await this.usersService.getUserFromSupabase(
                                adminUserId
                            );
                        if (user) {
                            adminDetailsMap.set(adminUserId as string , {
                                name:
                                    user.user_metadata?.full_name ??
                                    user.user_metadata?.name ??
                                    "Unknown Admin",
                                email: user.email ?? ""
                            });
                        }
                    } catch {
                        // ignore individual lookup errors
                    }
                })
            );
        }

        // Count total
        const countQb = this.adminAuditLogRepo.createQueryBuilder("log");

        if (dto.adminUserId) {
            countQb.andWhere("log.adminUserId = :adminUserId", {
                adminUserId: dto.adminUserId
            });
        }
        if (dto.companyId) {
            countQb.andWhere("log.companyId = :companyId", {
                companyId: dto.companyId
            });
        }
        if (dto.action) {
            countQb.andWhere("log.action = :action", { action: dto.action });
        }
        if (dto.severity) {
            countQb.andWhere("log.severity = :severity", {
                severity: dto.severity
            });
        }
        if (dto.search) {
            countQb.andWhere(
                new Brackets(sqb => {
                    sqb.where("log.message ILIKE :search", {
                        search: `%${dto.search}%`
                    }).orWhere("log.action ILIKE :search", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }
        if (dto.dateFrom) {
            countQb.andWhere("log.createdAt >= :dateFrom", {
                dateFrom: new Date(dto.dateFrom)
            });
        }
        if (dto.dateTo) {
            const endOfDay = new Date(dto.dateTo);
            endOfDay.setHours(23, 59, 59, 999);
            countQb.andWhere("log.createdAt <= :dateTo", { dateTo: endOfDay });
        }

        const total = await countQb.getCount();

        const auditLogs = rawRows.map(row => {
            const adminDetails = row.log_adminUserId
                ? adminDetailsMap.get(row.log_adminUserId)
                : null;

            return {
                id: row.log_id,
                adminUserId: row.log_adminUserId ?? null,
                adminName: adminDetails?.name ?? null,
                adminEmail: adminDetails?.email ?? null,
                companyId: row.log_companyId ?? null,
                action: row.log_action,
                severity: row.log_severity,
                message: row.log_message,
                createdAt: row.log_createdAt
            };
        });

        return {
            auditLogs,
            total,
            page,
            pageSize
        };
    }

    private buildCacheKey(dto: ListAdminAuditLogsDto): string {
        const parts = [
            dto.search ?? "",
            dto.action ?? "",
            dto.adminUserId ?? "",
            dto.companyId ?? "",
            dto.severity ?? "",
            dto.dateFrom ?? "",
            dto.dateTo ?? "",
            dto.page ?? 1,
            dto.pageSize ?? 20
        ];
        return `admin:audit-logs:list:${parts.join("|")}`;
    }
}
