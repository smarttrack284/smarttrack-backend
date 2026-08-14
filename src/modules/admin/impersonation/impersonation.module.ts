import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminImpersonationController } from './impersonation.controller';
import { AdminImpersonationService } from './impersonation.service';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { ActivityLogModule } from '#/modules/activity-log/activity-log.module';
import { AdminAuditLog } from '#/common/entities/admin-audit-log.entity';
import { UsersModule } from '#/modules/users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserRole, Company, AdminAuditLog]),
    ActivityLogModule,
    UsersModule,
  ],
  controllers: [AdminImpersonationController],
  providers: [AdminImpersonationService],
})
export class AdminImpersonationModule {}
