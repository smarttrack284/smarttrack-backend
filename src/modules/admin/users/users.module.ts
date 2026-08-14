import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersController } from './users.controller';
import { AdminUsersService } from './users.service';
import { SuperAdminGuard } from '#/common/guards/super-admin.guard';
import { UsersModule } from '#/modules/users/users.module';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { ActivityLogModule } from '#/modules/activity-log/activity-log.module';
import { AdminAuditLog } from '#/common/entities/admin-audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserRole, Company, AdminAuditLog]),
    UsersModule,
    ActivityLogModule,
    UsersModule,
  ],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, SuperAdminGuard],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}
