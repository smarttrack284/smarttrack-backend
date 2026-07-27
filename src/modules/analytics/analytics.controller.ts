import {Controller, Get, Query, UseGuards} from '@nestjs/common';
import {SupabaseAuthGuard} from '#/common/guards/supabase-auth.guard';
import {CurrentUser} from '#/common/decorators/current-user.decorator';
import type {AuthenticatedUser} from '#/common/types/authenticated-user.type';
import {UsersService} from '#/modules/users/users.service';
import {AnalyticsService} from './analytics.service';
import {AnalyticsQueryDto} from './dto/analytics-query.dto';
import {RolesGuard} from '#/common/guards/roles.guard';
import {Roles} from '#/common/decorators/roles.decorator';
import {TeamRoleType} from '#/common/types/team-role.type';
import {PlanGuard} from '#/common/guards/plan.guard';
import {RequirePlan} from '#/common/decorators/require-plan.decorator';
import {SubscriptionPlan} from '#/common/constants/subscription-plan.constant';

@UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
@RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
@Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async getAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.analyticsService.getAnalytics(userRole.companyId, query);
  }
}