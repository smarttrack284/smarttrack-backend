import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SignJWT } from 'jose';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { TeamRoleType } from '#/common/types/team-role.type';
import { TeamMemberStatus } from '#/common/constants/team-member-status.constant';
import {
  BadRequestAppException,
  InternalErrorException,
  ResourceNotFoundException,
} from '#/common/exceptions';
import { ErrorHandlerService, rule } from '#/common/errors/error-handler.service';
import { QueryFailedError } from 'typeorm';
import { ActivityLogService } from '#/modules/activity-log/activity-log.service';
import { ActivityCategory, ActivitySeverity } from '#/common/constants/activity-log.constant';

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
    private readonly config: ConfigService,
    private readonly errorHandler: ErrorHandlerService,
    private readonly activityLogService: ActivityLogService,
  ) {
    this.impersonationSecret = this.config.get<string>('IMPERSONATION_SECRET')!;
    if (!this.impersonationSecret) {
      throw new Error('IMPERSONATION_SECRET environment variable is required');
    }
  }

  async impersonateCompany(
    companyId: string,
    adminUserId: string,
    dto?: { userId?: string },
  ): Promise<{ accessToken: string; expiresIn: number; tokenType: string }> {
    try {
      const company = await this.companyRepo.findOne({ where: { id: companyId } });
      if (!company) {
        throw new ResourceNotFoundException('Company not found');
      }

      let targetUserRole: UserRole | null;

      if (dto?.userId) {
        // Impersonate a specific user
        targetUserRole = await this.userRoleRepo.findOne({
          where: { companyId, userId: dto.userId },
        });
        if (!targetUserRole) {
          throw new BadRequestAppException(
            'The specified user is not a member of this company',
          );
        }
      } else {
        // Impersonate the company owner
        targetUserRole = await this.userRoleRepo.findOne({
          where: { companyId, role: TeamRoleType.OWNER },
        });
        if (!targetUserRole) {
          throw new BadRequestAppException(
            'This company does not have an owner to impersonate',
          );
        }
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

      // Audit log
      await this.activityLogService.record({
        companyId,
        category: ActivityCategory.ADMIN_ACTION, // adjust if needed
        eventType: 'admin.impersonation_started',
        severity: ActivitySeverity.WARNING,
        message: `Admin ${adminUserId} impersonated user ${targetUserRole.userId} in company ${companyId}`,
        actorUserId: adminUserId,
        actorName: null, // can be enriched
        metadata: { impersonatedUserId: targetUserRole.userId, companyId },
      });

      return {
        accessToken: token,
        expiresIn: this.TOKEN_TTL_SECONDS,
        tokenType: 'Bearer',
      };
    } catch (err) {
      this.errorHandler.handle(err, 'AdminImpersonationService.impersonateCompany', [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to initiate impersonation. Please try again.',
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
}