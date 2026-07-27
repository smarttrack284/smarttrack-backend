import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { UsersService } from '#/modules/users/users.service';
import { OverviewService } from './overview.service';
import { Roles } from '#/common/decorators/roles.decorator';
import { RolesGuard } from '#/common/guards/roles.guard';
import { TeamRoleType } from '#/common/types/team-role.type';
import { PlanGuard } from '#/common/guards/plan.guard';
import { RequirePlan } from '#/common/decorators/require-plan.decorator';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';
import { ListActivityLogQueryDto } from '#/modules/activity-log/dto/list-activity-log.query.dto';
import { ListOrdersQueryDto } from '#/modules/orders/dto/list-orders.query.dto';

@Controller('overview')
export class OverviewController {
  constructor(
    private readonly overviewService: OverviewService,
    private readonly usersService: UsersService,
  ) {}

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Get()
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async getOverview(@CurrentUser() user: AuthenticatedUser) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    const [kpis, activity, recentOrders] = await Promise.all([
      this.overviewService.getKpis(userRole.companyId),
      this.overviewService.getRecentActivity(userRole.companyId),
      this.overviewService.getRecentOrders(userRole.companyId),
    ]);
    return { kpis, activity, recentOrders };
  }

  @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
  @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Get('advanced')
  async getAdvancedOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() activityQuery: ListActivityLogQueryDto,
    @Query() ordersQuery: ListOrdersQueryDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    const [kpis, activity, recentOrders] = await Promise.all([
      this.overviewService.getAdvancedKpis(userRole.companyId),
      this.overviewService.getAdvancedActivity(
        userRole.companyId,
        activityQuery,
      ),
      this.overviewService.getAdvancedRecentOrders(
        userRole.companyId,
        ordersQuery,
      ),
    ]);
    return { kpis, activity, recentOrders };
  }
}
