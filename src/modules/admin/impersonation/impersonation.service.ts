import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { SignJWT } from 'jose';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { TeamMemberStatus } from '#/common/constants/team-member-status.constant';
import { BadRequestAppException, InternalErrorException, ResourceNotFoundException, } from '#/common/exceptions';
import { ErrorHandlerService, rule, } from '#/common/errors/error-handler.service';
import { ActivityLogService } from '#/modules/activity-log/activity-log.service';
import { ActivityCategory, ActivitySeverity, } from '#/common/constants/activity-log.constant';
import { AdminAuditLog } from '#/common/entities/admin-audit-log.entity';
import { UsersService } from '#/modules/users/users.service';

@Injectable()
export class AdminImpersonationService {
  private readonly logger = new Logger(AdminImpersonationService.name);
  private readonly impersonationSecret: string;
  private readonly TOKEN_TTL_SECONDS = 600; // 10 minutes

  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(AdminAuditLog)
    private readonly adminAuditLogRepo: Repository<AdminAuditLog>,
    private readonly config: ConfigService,
    private readonly errorHandler: ErrorHandlerService,
    private readonly activityLogService: ActivityLogService,
    private readonly usersService: UsersService,
  ) {
    this.impersonationSecret = this.config.get<string>('IMPERSONATION_SECRET')!;
    if (!this.impersonationSecret) {
      throw new Error('IMPERSONATION_SECRET environment variable is required');
    }
  }

  async impersonateCompany(
    companyId: string,
    adminUserId: string,
    dto: { userId: string },
  ): Promise<{ accessToken: string; expiresIn: number; tokenType: string }> {
    try {
      const company = await this.companyRepo.findOne({
        where: { id: companyId },
      });
      if (!company) {
        throw new ResourceNotFoundException('Company not found');
      }

      if (!dto.userId) {
        throw new BadRequestAppException('No target user was provided');
      }

      // Impersonate a specific user
      const targetUserRole = await this.userRoleRepo.findOne({
        where: { companyId, userId: dto.userId },
      });

      if (!targetUserRole) {
        throw new BadRequestAppException(
          'The specified user is not a member of this company',
        );
      }

      if (targetUserRole.status !== TeamMemberStatus.ACTIVE) {
        throw new BadRequestAppException(
          'The target user is not active and cannot be impersonated',
        );
      }

      // Generate short-lived JWT
      const token = await new SignJWT({
        sub: targetUserRole.userId!,
        email: targetUserRole.email,
        companyId: targetUserRole.companyId,
        role: targetUserRole.role,
        impersonatedBy: adminUserId,
        impersonated: true,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${this.TOKEN_TTL_SECONDS}s`)
        .sign(new TextEncoder().encode(this.impersonationSecret));

      const adminUser =
        await this.usersService.getUserFromSupabase(adminUserId);

      // Audit log
      await this.activityLogService.record({
        companyId,
        category: ActivityCategory.ADMIN_ACTION,
        eventType: 'admin.impersonation_started',
        severity: ActivitySeverity.WARNING,
        message: `Admin ${adminUserId} impersonated user ${targetUserRole.userId} in company ${companyId}`,
        actorUserId: adminUserId,
        actorName: adminUser.user_metadata?.full_name,
        metadata: { impersonatedUserId: targetUserRole.userId, companyId },
      });

      // Admin Audit log
      await this.adminAuditLogRepo.save({
        adminUserId,
        companyId,
        action: 'admin.impersonation_started',
        severity: ActivitySeverity.WARNING,
        message: `Admin ${adminUserId} impersonated user ${targetUserRole.userId} in company ${companyId}`,
        metadata: { impersonatedUserId: targetUserRole.userId, companyId },
      });

      return {
        accessToken: token,
        expiresIn: this.TOKEN_TTL_SECONDS,
        tokenType: 'Bearer',
      };
    } catch (err) {
      this.errorHandler.handle(
        err,
        'AdminImpersonationService.impersonateCompany',
        [
          rule(
            QueryFailedError,
            () =>
              new InternalErrorException(
                'Unable to initiate impersonation. Please try again.',
              ),
          ),
          rule(
            Error,
            () =>
              new InternalErrorException(
                'An unexpected error occurred. Please try again later.',
              ),
          ),
        ],
      );
    }
  }
}