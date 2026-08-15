import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '#/common/guards/admin-auth.guard';
import { SuperAdminGuard } from '#/common/guards/super-admin.guard';
import { AdminActivityLogService } from './activity-log.service';
import { ListActivityLogAdminDto } from './dto/list-activity-log-admin.dto';
import { PublicThrottle } from '#/common/decorators/throttle.decorator';

@UseGuards(AdminAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller('admin/activity-log')
export class AdminActivityLogController {
  constructor(
    private readonly adminActivityLogService: AdminActivityLogService,
  ) {}

  @Get()
  async listActivityLog(@Query() dto: ListActivityLogAdminDto) {
    return this.adminActivityLogService.listActivityLog(dto);
  }
}
