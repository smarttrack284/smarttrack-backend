import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { SuperAdminGuard } from '#/common/guards/super-admin.guard';
import { AdminDashboardService } from './dashboard.service';
import { PublicThrottle } from '#/common/decorators/throttle.decorator';

@UseGuards(SupabaseAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get('stats')
  async getStats() {
    return this.adminDashboardService.getStats();
  }
}
