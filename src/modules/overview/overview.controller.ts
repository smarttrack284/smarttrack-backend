import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { UsersService } from '#/modules/users/users.service';
import { OverviewService } from './overview.service';

@UseGuards(SupabaseAuthGuard)
@Controller('overview')
export class OverviewController {
  constructor(
    private readonly overviewService: OverviewService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async getOverview(@CurrentUser() user: AuthenticatedUser) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    const [kpis, activity, recentOrders] = await Promise.all([
      this.overviewService.getKpis(userRole.companyId),
      this.overviewService.getRecentActivity(userRole.companyId),
      this.overviewService.getRecentOrders(userRole.companyId),
    ]);
    return { kpis, activity, recentOrders };
  }
}
