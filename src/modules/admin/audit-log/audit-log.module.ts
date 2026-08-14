import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLog } from '#/common/entities/admin-audit-log.entity';
import { AdminAuditLogController } from './audit-log.controller';
import { AdminAuditLogService } from './audit-log.service';
import { UsersModule } from '#/modules/users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAuditLog]), UsersModule],
  controllers: [AdminAuditLogController],
  providers: [AdminAuditLogService,],
})
export class AdminAuditLogModule {}
