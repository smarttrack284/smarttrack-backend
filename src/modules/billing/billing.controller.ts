import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { UsersService } from '#/modules/users/users.service';
import { BillingService } from './billing.service';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async getOverview(@CurrentUser() user: AuthenticatedUser) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.billingService.getBillingOverview(userRole.companyId);
  }

  @Patch('plan')
  async changePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSubscriptionPlanDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    // TODO: for STARTER/PRO, this must route through a payment provider
    // checkout flow BEFORE calling changePlan — see the service method's
    // comment. Only FREE is safe to apply directly from this endpoint
    // as-is; gate the others behind actual payment confirmation before
    // this goes live.
    return this.billingService.changePlan(userRole.companyId, dto);
  }
}
