import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
    Brackets,
    DataSource,
    EntityManager,
    QueryFailedError,
    Repository
} from "typeorm";
import { UserRole } from "#/common/entities/user-role.entity";
import { Company } from "#/common/entities/company.entity";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { UsersService } from "#/modules/users/users.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import {
    ErrorHandlerService,
    rule
} from "#/common/errors/error-handler.service";
import {
    AppException,
    BadRequestAppException,
    ForbiddenAppException,
    InternalErrorException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { ActivityLogService } from "#/modules/activity-log/activity-log.service";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";
import { TeamRoleType } from "#/common/types/team-role.type";
import {
    ActivityCategory,
    ActivitySeverity
} from "#/common/constants/activity-log.constant";
import { ConfigService } from "@nestjs/config";
import { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_CLIENT } from "#/common/constants/supabase.constant";
import { ListUsersDto } from "#/modules/admin/users/dto/list-users.dto";
import { AdminAuditLog } from "#/common/entities/admin-audit-log.entity";
import { StorageCleanupService } from "#/modules/storage-cleanup/storage-cleanup.service";
import { StoragePath } from "#/common/storage/storage-path.util";
import { UsageService } from "#/modules/usage/usage.service";
import { StopStatus } from "#/common/constants/stop-status.constant";

@Injectable()
export class AdminUsersService {
    private readonly logger = new Logger(AdminUsersService.name);
    private readonly CACHE_TTL_SECONDS = 60;

    constructor(
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        @InjectRepository(TripStop)
        private readonly tripStopRepo: Repository<TripStop>,
        @InjectRepository(AdminAuditLog)
        private readonly adminAuditLogRepo: Repository<AdminAuditLog>,
        private readonly usersService: UsersService,
        private readonly cache: RedisCacheService,
        private readonly errorHandler: ErrorHandlerService,
        @InjectDataSource()
        private readonly dataSource: DataSource,
        private readonly activityLogService: ActivityLogService,
        private readonly config: ConfigService,
        private readonly storageCleanupService: StorageCleanupService,
        private readonly usageService: UsageService,
        @Inject(SUPABASE_CLIENT) private readonly supabaseAdmin: SupabaseClient
    ) {}

    async getUserDetail(userId: string) {
        const cacheKey = `admin:users:detail:${userId}`;

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.buildUserDetail(userId)
            );
        } catch (err) {
            this.errorHandler.handle(err, "AdminUsersService.getUserDetail", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to load user details. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async suspendUser(userId: string, adminUserId: string) {
        try {
            const result = await this.withTransaction(undefined, async trx => {
                const userRoleRepo = trx.getRepository(UserRole);

                const membership = await userRoleRepo.findOne({
                    where: { userId }
                });
                if (!membership) {
                    throw new ResourceNotFoundException("User not found");
                }

                // Prevent suspending owners
                if (membership.role === TeamRoleType.OWNER) {
                    throw new ForbiddenAppException(
                        "Owners cannot be suspended. You must transfer ownership first."
                    );
                }

                // Prevent suspending drivers with active deliveries
                if (
                    membership.role === TeamRoleType.DRIVER &&
                    membership.userId &&
                    (await this.isDriverAssignedToTrip(
                        membership.companyId,
                        membership.userId
                    ))
                ) {
                    throw new ForbiddenAppException(
                        "This driver is currently assigned to an active trip and cannot be suspended."
                    );
                }

                // Ban the user in Supabase (revokes sessions)
                await this.usersService.banSupabaseUser(userId);

                // Update membership to SUSPENDED
                await userRoleRepo.update(
                    { userId },
                    { status: TeamMemberStatus.SUSPENDED }
                );

                return {
                    success: true,
                    userId,
                    name: membership.name,
                    state: "suspended",
                    companyId: membership.companyId
                };
            });

            await this.cache.del(`user:company:${userId}`);

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            await this.activityLogService.record({
                companyId: result.companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.user_suspended",
                severity: ActivitySeverity.WARNING,
                message: `Admin suspended user ${result.name}`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata?.full_name
            });

            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId: result.companyId,
                action: "admin.user_suspended",
                severity: ActivitySeverity.WARNING,
                message: `Admin suspended user ${result.name}`
            });

            return result;
        } catch (err) {
            this.errorHandler.handle(err, "AdminUsersService.suspendUser", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to suspend user. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async reactivateUser(userId: string, adminUserId: string) {
        try {
            const result = await this.withTransaction(undefined, async trx => {
                const userRoleRepo = trx.getRepository(UserRole);

                const membership = await userRoleRepo.findOne({
                    where: { userId }
                });
                if (!membership) {
                    throw new ResourceNotFoundException("User not found");
                }

                await this.usersService.unbanSupabaseUser(userId);

                await userRoleRepo.update(
                    { userId },
                    { status: TeamMemberStatus.ACTIVE }
                );

                return {
                    success: true,
                    userId,
                    name: membership.name,
                    state: "active",
                    companyId: membership.companyId
                };
            });

            await this.cache.del(`user:company:${userId}`);

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            await this.activityLogService.record({
                companyId: result.companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.user_reactivated",
                severity: ActivitySeverity.WARNING,
                message: `Admin reactivated user ${result.name}`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata?.full_name
            });

            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId: result.companyId,
                action: "admin.user_reactivated",
                severity: ActivitySeverity.WARNING,
                message: `Admin reactivated user ${result.name}`
            });

            return result;
        } catch (err) {
            this.errorHandler.handle(err, "AdminUsersService.reactivateUser", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to reactivate user. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async removeUser(userId: string, adminUserId: string) {
        try {
            // Fetch membership
            const membership = await this.userRoleRepo.findOne({
                where: { userId }
            });
            if (!membership) {
                throw new ResourceNotFoundException("User not found");
            }

            // Prevent removing owners
            if (membership.role === TeamRoleType.OWNER) {
                throw new ForbiddenAppException(
                    "Owners cannot be removed. You must transfer ownership first."
                );
            }

            // Prevent removing drivers with active deliveries
            if (
                membership.role === TeamRoleType.DRIVER &&
                membership.userId &&
                (await this.isDriverAssignedToTrip(
                    membership.companyId,
                    membership.userId
                ))
            ) {
                throw new ForbiddenAppException(
                    "This driver is currently assigned to an active trip and cannot be removed."
                );
            }

            // Get avatar filename from Supabase (before deletion)
            let avatarFilename: string | undefined;
            try {
                const { data: supabaseUser } =
                    await this.supabaseAdmin.auth.admin.getUserById(userId);
                const metadata = supabaseUser.user?.user_metadata as
                    | Record<string, unknown>
                    | undefined;
                avatarFilename = metadata?.avatar_filename as
                    | string
                    | undefined;
            } catch (err) {
                this.logger.warn({
                    msg: `Failed to fetch Supabase user for avatar cleanup ${userId}`,
                    err: err instanceof Error ? err.message : String(err)
                });
            }

            // Remove membership + decrement usage in transaction
            await this.withTransaction(undefined, async trx => {
                const userRoleRepo = trx.getRepository(UserRole);
                await userRoleRepo.delete({ id: membership.id });
                await this.usageService.decrementTeamMemberCount(
                    membership.companyId,
                    trx
                );
            });

            // Delete Supabase user (best effort)
            try {
                const { error: deleteError } =
                    await this.supabaseAdmin.auth.admin.deleteUser(userId);
                if (deleteError) {
                    this.logger.error({
                        msg: `Failed to delete Supabase user ${userId} after removal`,
                        err: deleteError.message
                    });
                }
            } catch (supabaseErr) {
                this.logger.error({
                    msg: `Supabase deleteUser threw for ${userId}`,
                    err:
                        supabaseErr instanceof Error
                            ? supabaseErr.message
                            : String(supabaseErr)
                });
            }

            // Enqueue avatar deletion
            if (avatarFilename) {
                const avatarPath = StoragePath.userAvatar(
                    membership.companyId,
                    userId,
                    avatarFilename
                );
                await this.storageCleanupService.enqueueDelete(
                    avatarPath,
                    "admin_removed_user"
                );
            }

            // Invalidate caches
            await this.cache.del(`user:company:${userId}`);
            await this.cache.del(`admin:users:detail:${userId}`);
            await this.cache.del("admin:users:list:*");

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            await this.activityLogService.record({
                companyId: membership.companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.user_removed",
                severity: ActivitySeverity.CRITICAL,
                message: `Admin permanently removed user ${membership.name}`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata?.full_name
            });

            // Admin audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId: membership.companyId,
                action: "admin.user_removed",
                severity: ActivitySeverity.CRITICAL,
                message: `Admin permanently removed user ${membership.name}`
            });

            return { success: true, userId };
        } catch (err) {
            this.errorHandler.handle(err, "AdminUsersService.removeUser", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to remove user. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async sendPasswordResetEmail(email: string): Promise<void> {
        try {
            const { error } =
                await this.supabaseAdmin.auth.resetPasswordForEmail(email, {
                    redirectTo: `${this.config.get(
                        "CLIENT_URL"
                    )}/reset-password`
                });

            if (error) {
                const message = error.message.toLowerCase();

                if (
                    message.includes("user not found") ||
                    message.includes("no user found")
                ) {
                    throw new ResourceNotFoundException(
                        "No account found with that email address."
                    );
                }

                if (message.includes("email not confirmed")) {
                    throw new BadRequestAppException(
                        "Email address is not confirmed. Please confirm it first."
                    );
                }

                if (
                    message.includes("too many requests") ||
                    message.includes("over request rate limit")
                ) {
                    throw new BadRequestAppException(
                        "Too many password reset requests. Please try again later."
                    );
                }

                if (message.includes("invalid email")) {
                    throw new BadRequestAppException("Invalid email address.");
                }

                this.logger.error({
                    msg: "Supabase resetPasswordForEmail error",
                    email,
                    err: error.message
                });
                throw new InternalErrorException(
                    "Unable to send password reset email."
                );
            }
        } catch (err) {
            if (err instanceof AppException) {
                throw err;
            }

            this.logger.error({
                msg: "Failed to send password reset email",
                email,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            throw new InternalErrorException(
                "Unable to send password reset email. Please try again later."
            );
        }
    }

    async listUsers(dto: ListUsersDto) {
        const cacheKey = this.buildListUsersCacheKey(dto);

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.queryUsers(dto)
            );
        } catch (err) {
            this.errorHandler.handle(err, "AdminUsersService.listUsers", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to list users. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    private buildListUsersCacheKey(dto: ListUsersDto): string {
        const parts = [
            dto.search ?? "",
            dto.role ?? "",
            dto.status ?? "",
            dto.companyId ?? "",
            dto.page ?? 1,
            dto.pageSize ?? 20
        ];
        return `admin:users:list:${parts.join("|")}`;
    }

    private async queryUsers(dto: ListUsersDto) {
        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 20;

        const qb = this.userRoleRepo
            .createQueryBuilder("member")
            .leftJoin(Company, "company", "company.id = member.companyId")
            .select([
                "member.userId",
                "member.name",
                "member.email",
                "member.role",
                "member.avatarUrl",
                "member.status",
                "member.companyId",
                "member.invitedAt",
                "member.joinedAt"
            ])
            .addSelect("company.name", "companyName");

        if (dto.search) {
            qb.andWhere(
                new Brackets(sqb => {
                    sqb.where("member.name ILIKE :search", {
                        search: `%${dto.search}%`
                    }).orWhere("member.email ILIKE :search", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }

        if (dto.role) {
            qb.andWhere("member.role = :role", { role: dto.role });
        }

        if (dto.status) {
            qb.andWhere("member.status = :status", { status: dto.status });
        }

        if (dto.companyId) {
            qb.andWhere("member.companyId = :companyId", {
                companyId: dto.companyId
            });
        }

        qb.orderBy("member.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const rawRows = await qb.getRawMany<{
            member_userId: string | null;
            member_name: string | null;
            member_email: string;
            member_avatarUrl: string | null;
            member_role: string;
            member_status: string;
            member_companyId: string;
            member_invitedAt: Date | null;
            member_joinedAt: Date | null;
            companyName: string | null;
        }>();

        const countQb = this.userRoleRepo
            .createQueryBuilder("member")
            .leftJoin(Company, "company", "company.id = member.companyId");

        if (dto.search) {
            countQb.andWhere(
                new Brackets(sqb => {
                    sqb.where("member.name ILIKE :search", {
                        search: `%${dto.search}%`
                    }).orWhere("member.email ILIKE :search", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }
        if (dto.role) {
            countQb.andWhere("member.role = :role", { role: dto.role });
        }
        if (dto.status) {
            countQb.andWhere("member.status = :status", { status: dto.status });
        }
        if (dto.companyId) {
            countQb.andWhere("member.companyId = :companyId", {
                companyId: dto.companyId
            });
        }

        const total = await countQb.getCount();

        const users = rawRows.map(row => ({
            userId: row.member_userId,
            name: row.member_name ?? row.member_email,
            email: row.member_email,
            role: row.member_role,
            avatarUrl: row.member_avatarUrl,
            status: row.member_status,
            companyId: row.member_companyId,
            companyName: row.companyName ?? "Unknown",
            invitedAt: row.member_invitedAt,
            joinedAt: row.member_joinedAt
        }));

        return {
            users,
            total,
            page,
            pageSize
        };
    }

    private async buildUserDetail(userId: string) {
        const supabaseUser =
            await this.usersService.getUserFromSupabase(userId);
        if (!supabaseUser) {
            throw new ResourceNotFoundException("User not found");
        }

        const membership = await this.userRoleRepo.findOne({
            where: { userId }
        });

        let company: any = null;
        if (membership) {
            const companyRecord = await this.companyRepo.findOne({
                where: { id: membership.companyId }
            });
            company = {
                companyId: membership.companyId,
                companyName: companyRecord?.name ?? "Unknown",
                role: membership.role,
                status: membership.status,
                joinedAt: membership.joinedAt
            };
        }

        const response = {
            user: {
                id: userId,
                email: supabaseUser.email ?? "",
                phone:
                    supabaseUser.phone ??
                    supabaseUser.user_metadata?.phone ??
                    null,
                createdAt: supabaseUser.created_at
                    ? new Date(supabaseUser.created_at)
                    : null,
                isBanned:
                    supabaseUser.banned_until &&
                    new Date(supabaseUser.banned_until) > new Date(),
                metadata: supabaseUser.user_metadata ?? {}
            },
            company
        };

        this.logger.log({
            msg: "Loaded user detail",
            userId,
            companyId: membership?.companyId ?? null
        });

        return response;
    }

    /**
     * Returns true if the driver is currently assigned to any trip with
     * pending or arrived stops — meaning they have active work.
     */
    private async isDriverAssignedToTrip(
        companyId: string,
        driverUserId: string
    ): Promise<boolean> {
        const count = await this.tripStopRepo
            .createQueryBuilder("stop")
            .innerJoin("stop.trip", "trip")
            .where("trip.companyId = :companyId", { companyId })
            .andWhere("trip.driverUserId = :driverUserId", { driverUserId })
            .andWhere("stop.status IN (:...statuses)", {
                statuses: [StopStatus.PENDING, StopStatus.ARRIVED]
            })
            .getCount();

        return count > 0;
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
}
