import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLog } from '#/common/entities/activity-log.entity';
import { Company } from '#/common/entities/company.entity';
import { AdminActivityLogController } from './activity-log.controller';
import { AdminActivityLogService } from './activity-log.service';
import { UserRole } from '#/common/entities/user-role.entity';
import { AdminAuthGuard } from '#/common/guards/admin-auth.guard';
import { AdminUser } from '#/common/entities/admin-user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityLog, Company, UserRole, AdminUser]),
  ],
  controllers: [AdminActivityLogController],
  providers: [AdminActivityLogService, AdminAuthGuard],
  exports: [AdminActivityLogService],
})
export class AdminActivityLogModule {}
