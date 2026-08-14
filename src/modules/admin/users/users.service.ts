import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { UsersService } from '#/modules/users/users.service';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import {
  ErrorHandlerService,
  rule,
} from '#/common/errors/error-handler.service';
import {
  AppException,
  BadRequestAppException,
  InternalErrorException,
  ResourceNotFoundException,
} from '#/common/exceptions';
import { ActivityLogService } from '#/modules/activity-log/activity-log.service';
import { TeamMemberStatus } from '#/common/constants/team-member-status.constant';
import {
  ActivityCategory,
  ActivitySeverity,
} from '#/common/constants/activity-log.constant';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '#/common/constants/supabase.constant';
import { ListUsersDto } from '#/modules/admin/users/dto/list-users.dto';
import { AdminAuditLog } from '#/common/entities/admin-audit-log.entity';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);
  private readonly CACHE_TTL_SECONDS = 60;

  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(AdminAuditLog)
    private readonly adminAuditLogRepo: Repository<AdminAuditLog>,
    private readonly usersService: UsersService,
    private readonly cache: RedisCacheService,
    private readonly errorHandler: ErrorHandlerService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly activityLogService: ActivityLogService,
    private readonly config: ConfigService,
    @Inject(SUPABASE_CLIENT) private readonly supabaseAdmin: SupabaseClient,
  ) {}

  async getUserDetail(userId: string) {
    const cacheKey = `admin:users:detail:${userId}`;

    try {
      return await this.cache.getOrSet(cacheKey, this.CACHE_TTL_SECONDS, () =>
        this.buildUserDetail(userId),
      );
    } catch (err) {
      this.errorHandler.handle(err, 'AdminUsersService.getUserDetail', [
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to load user details. Please try again.',
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

  async suspendUser(userId: string, adminUserId: string) {
    try {
      const result = await this.withTransaction(undefined, async (trx) => {
        const userRoleRepo = trx.getRepository(UserRole);

        // Fetch the user's single membership to get companyId
        const membership = await userRoleRepo.findOne({ where: { userId } });
        if (!membership) {
          throw new ResourceNotFoundException('User not found');
        }

        // Ban the user in Supabase (revokes sessions)
        await this.usersService.banSupabaseUser(userId);

        // Update membership to SUSPENDED
        await userRoleRepo.update(
          { userId },
          { status: TeamMemberStatus.SUSPENDED },
        );

        return {
          success: true,
          userId,
          state: 'suspended',
          companyId: membership.companyId,
        };
      });

      // Invalidate cached membership
      await this.cache.del(`user:company:${userId}`);

      const adminUser =
        await this.usersService.getUserRoleByUserId(adminUserId);

      // Audit log with correct companyId
      await this.activityLogService.record({
        companyId: result.companyId,
        category: ActivityCategory.ADMIN_ACTION,
        eventType: 'admin.user_suspended',
        severity: ActivitySeverity.WARNING,
        message: `Admin suspended user ${userId}`,
        actorUserId: adminUserId,
        actorName: adminUser.name,
      });

      // Admin Audit log
      await this.adminAuditLogRepo.save({
        adminUserId,
        companyId: result.companyId,
        action: 'admin.user_suspended',
        severity: ActivitySeverity.WARNING,
        message: `Admin suspended user ${userId}`,
      });

      return result;
    } catch (err) {
      this.errorHandler.handle(err, 'AdminUsersService.suspendUser', [
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to suspend user. Please try again.',
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

  async reactivateUser(userId: string, adminUserId: string) {
    try {
      const result = await this.withTransaction(undefined, async (trx) => {
        const userRoleRepo = trx.getRepository(UserRole);

        const membership = await userRoleRepo.findOne({ where: { userId } });
        if (!membership) {
          throw new ResourceNotFoundException('User not found');
        }

        // Unban the user in Supabase
        await this.usersService.unbanSupabaseUser(userId);

        // Update membership to ACTIVE
        await userRoleRepo.update(
          { userId },
          { status: TeamMemberStatus.ACTIVE },
        );

        return {
          success: true,
          userId,
          state: 'active',
          companyId: membership.companyId,
        };
      });

      await this.cache.del(`user:company:${userId}`);

      const adminUser =
        await this.usersService.getUserRoleByUserId(adminUserId);

      await this.activityLogService.record({
        companyId: result.companyId,
        category: ActivityCategory.ADMIN_ACTION,
        eventType: 'admin.user_reactivated',
        severity: ActivitySeverity.WARNING,
        message: `Admin reactivated user ${userId}`,
        actorUserId: adminUserId,
        actorName: adminUser.name,
      });

      // Admin Audit log
      await this.adminAuditLogRepo.save({
        adminUserId,
        companyId: result.companyId,
        action: 'admin.user_reactivated',
        severity: ActivitySeverity.WARNING,
        message: `Admin reactivated user ${userId}`,
      });

      return result;
    } catch (err) {
      this.errorHandler.handle(err, 'AdminUsersService.reactivateUser', [
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to reactivate user. Please try again.',
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

  async sendPasswordResetEmail(email: string): Promise<void> {
    try {
      const { error } = await this.supabaseAdmin.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${this.config.get('CLIENT_URL')}/reset-password`,
        },
      );

      if (error) {
        const message = error.message.toLowerCase();

        // User not found – safe to reveal in admin context
        if (
          message.includes('user not found') ||
          message.includes('no user found')
        ) {
          throw new ResourceNotFoundException(
            'No account found with that email address.',
          );
        }

        // Email not confirmed – user must verify first
        if (message.includes('email not confirmed')) {
          throw new BadRequestAppException(
            'Email address is not confirmed. Please confirm it first.',
          );
        }

        // Rate limited by Supabase
        if (
          message.includes('too many requests') ||
          message.includes('over request rate limit')
        ) {
          throw new BadRequestAppException(
            'Too many password reset requests. Please try again later.',
          );
        }

        // Invalid email format (should be caught earlier, but just in case)
        if (message.includes('invalid email')) {
          throw new BadRequestAppException('Invalid email address.');
        }

        // Unknown error – log full details and throw generic
        this.logger.error({
          msg: 'Supabase resetPasswordForEmail error',
          email,
          err: error.message,
        });
        throw new InternalErrorException(
          'Unable to send password reset email.',
        );
      }
    } catch (err) {
      // Let known AppExceptions pass through untouched
      if (err instanceof AppException) {
        throw err;
      }

      // Log unexpected failures and wrap
      this.logger.error({
        msg: 'Failed to send password reset email',
        email,
        err: (err as Error).message,
        stack: (err as Error).stack,
      });
      throw new InternalErrorException(
        'Unable to send password reset email. Please try again later.',
      );
    }
  }

  async listUsers(dto: ListUsersDto) {
    const cacheKey = this.buildListUsersCacheKey(dto);

    try {
      return await this.cache.getOrSet(cacheKey, this.CACHE_TTL_SECONDS, () =>
        this.queryUsers(dto),
      );
    } catch (err) {
      this.errorHandler.handle(err, 'AdminUsersService.listUsers', [
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to list users. Please try again.',
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

  private buildListUsersCacheKey(dto: ListUsersDto): string {
    const parts = [
      dto.search ?? '',
      dto.role ?? '',
      dto.status ?? '',
      dto.companyId ?? '',
      dto.page ?? 1,
      dto.pageSize ?? 20,
    ];
    return `admin:users:list:${parts.join('|')}`;
  }

  private async queryUsers(dto: ListUsersDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const qb = this.userRoleRepo
      .createQueryBuilder('member')
      .leftJoin(Company, 'company', 'company.id = member.companyId')
      .select([
        'member.userId',
        'member.name',
        'member.email',
        'member.role',
        'member.avatarUrl',
        'member.status',
        'member.companyId',
        'member.invitedAt',
        'member.joinedAt',
      ])
      .addSelect('company.name', 'companyName');

    // Filters
    if (dto.search) {
      qb.andWhere(
        new Brackets((sqb) => {
          sqb
            .where('member.name ILIKE :search', {
              search: `%${dto.search}%`,
            })
            .orWhere('member.email ILIKE :search', {
              search: `%${dto.search}%`,
            });
        }),
      );
    }

    if (dto.role) {
      qb.andWhere('member.role = :role', { role: dto.role });
    }

    if (dto.status) {
      qb.andWhere('member.status = :status', { status: dto.status });
    }

    if (dto.companyId) {
      qb.andWhere('member.companyId = :companyId', {
        companyId: dto.companyId,
      });
    }

    qb.orderBy('member.createdAt', 'DESC')
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

    // Count total
    const countQb = this.userRoleRepo
      .createQueryBuilder('member')
      .leftJoin(Company, 'company', 'company.id = member.companyId');

    if (dto.search) {
      countQb.andWhere(
        new Brackets((sqb) => {
          sqb
            .where('member.name ILIKE :search', {
              search: `%${dto.search}%`,
            })
            .orWhere('member.email ILIKE :search', {
              search: `%${dto.search}%`,
            });
        }),
      );
    }
    if (dto.role) {
      countQb.andWhere('member.role = :role', { role: dto.role });
    }
    if (dto.status) {
      countQb.andWhere('member.status = :status', { status: dto.status });
    }
    if (dto.companyId) {
      countQb.andWhere('member.companyId = :companyId', {
        companyId: dto.companyId,
      });
    }

    const total = await countQb.getCount();

    const users = rawRows.map((row) => ({
      userId: row.member_userId,
      name: row.member_name ?? row.member_email,
      email: row.member_email,
      role: row.member_role,
      avatarUrl: row.member_avatarUrl,
      status: row.member_status,
      companyId: row.member_companyId,
      companyName: row.companyName ?? 'Unknown',
      invitedAt: row.member_invitedAt,
      joinedAt: row.member_joinedAt,
    }));

    return {
      users,
      total,
      page,
      pageSize,
    };
  }

  private async buildUserDetail(userId: string) {
    const supabaseUser = await this.usersService.getUserFromSupabase(userId);
    if (!supabaseUser) {
      throw new ResourceNotFoundException('User not found');
    }

    // Single membership (one user = one company)
    const membership = await this.userRoleRepo.findOne({
      where: { userId },
    });

    let company: any = null;
    if (membership) {
      const companyRecord = await this.companyRepo.findOne({
        where: { id: membership.companyId },
      });
      company = {
        companyId: membership.companyId,
        companyName: companyRecord?.name ?? 'Unknown',
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
      };
    }

    const response = {
      user: {
        id: userId,
        email: supabaseUser.email ?? '',
        phone: supabaseUser.phone ?? supabaseUser.user_metadata?.phone ?? null,
        createdAt: supabaseUser.created_at
          ? new Date(supabaseUser.created_at)
          : null,
        isBanned:
          supabaseUser.banned_until &&
          new Date(supabaseUser.banned_until) > new Date(),
        metadata: supabaseUser.user_metadata ?? {},
      },
      company,
    };

    this.logger.log({
      msg: 'Loaded user detail',
      userId,
      companyId: membership?.companyId ?? null,
    });

    return response;
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
}
