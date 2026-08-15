import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersController } from './users.controller';
import { AdminUsersService } from './users.service';
import { AdminAuthGuard } from '#/common/guards/admin-auth.guard';
import { UsersModule } from '#/modules/users/users.module';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { ActivityLogModule } from '#/modules/activity-log/activity-log.module';
import { AdminAuditLog } from '#/common/entities/admin-audit-log.entity';
import { AdminUser } from '#/common/entities/admin-user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserRole, Company, AdminAuditLog, AdminUser]),
    UsersModule,
    ActivityLogModule,
    UsersModule,
  ],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, AdminAuthGuard],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}
