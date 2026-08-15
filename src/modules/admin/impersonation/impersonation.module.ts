import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminImpersonationController } from './impersonation.controller';
import { AdminImpersonationService } from './impersonation.service';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { ActivityLogModule } from '#/modules/activity-log/activity-log.module';
import { AdminAuditLog } from '#/common/entities/admin-audit-log.entity';
import { UsersModule } from '#/modules/users/users.module';
import { AdminAuditLogModule } from '../audit-log/audit-log.module';
import { AdminAuthGuard } from '#/common/guards/admin-auth.guard';
import { AdminUser } from '#/common/entities/admin-user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserRole, Company, AdminAuditLog, AdminUser]),
    ActivityLogModule,
    UsersModule,
    AdminAuditLogModule,
  ],
  controllers: [AdminImpersonationController],
  providers: [AdminImpersonationService, AdminAuthGuard],
})
export class AdminImpersonationModule {}
