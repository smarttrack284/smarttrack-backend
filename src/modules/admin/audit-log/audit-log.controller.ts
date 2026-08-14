import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { SuperAdminGuard } from '#/common/guards/super-admin.guard';
import { AdminAuditLogService } from './audit-log.service';
import { ListAdminAuditLogsDto } from './dto/list-admin-audit-logs.dto';

@UseGuards(SupabaseAuthGuard, SuperAdminGuard)
@Controller('admin/audit-logs')
export class AdminAuditLogController {
  constructor(private readonly adminAuditLogService: AdminAuditLogService) {}

  @Get()
  async listAuditLogs(@Query() dto: ListAdminAuditLogsDto) {
    return this.adminAuditLogService.listAuditLogs(dto);
  }
}
