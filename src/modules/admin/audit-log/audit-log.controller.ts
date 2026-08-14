import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminAuditLogService } from "./audit-log.service";
import { ListAdminAuditLogsDto } from "./dto/list-admin-audit-logs.dto";

@UseGuards(AdminAuthGuard, SuperAdminGuard)
@Controller("admin/audit-logs")
export class AdminAuditLogController {
    constructor(private readonly adminAuditLogService: AdminAuditLogService) {}

    @Get()
    async listAuditLogs(@Query() dto: ListAdminAuditLogsDto) {
        return this.adminAuditLogService.listAuditLogs(dto);
    }
}
