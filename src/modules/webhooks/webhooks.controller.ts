import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, } from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { PlanGuard } from '#/common/guards/plan.guard';
import { RequirePlan } from '#/common/decorators/require-plan.decorator';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { UsersService } from '#/modules/users/users.service';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { ListWebhookDeliveriesQueryDto } from './dto/list-webhook-deliveries.query.dto';
import { RolesGuard } from '#/common/guards/roles.guard';
import { Roles } from '#/common/decorators/roles.decorator';
import { TeamRoleType } from '#/common/types/team-role.type';
import { PublicThrottle } from '#/common/decorators/throttle.decorator';

@Controller('webhooks')
@UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
@PublicThrottle()
@RequirePlan(SubscriptionPlan.PRO)
@Roles(TeamRoleType.OWNER)
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWebhookDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    const { endpoint, secret } = await this.webhooksService.createWebhook(
      userRole.companyId,
      dto,
    );
    return { ...endpoint, secret, secretEncrypted: undefined };
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.webhooksService.listForCompany(userRole.companyId);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.webhooksService.updateWebhook(userRole.companyId, id, dto);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.webhooksService.deleteWebhook(userRole.companyId, id);
    return { success: true };
  }

  @Get(':id/deliveries')
  async listDeliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListWebhookDeliveriesQueryDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.webhooksService.listDeliveries(userRole.companyId, id, query);
  }

  @Post(':id/deliveries/:deliveryId/retry')
  async retryDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.webhooksService.retryDelivery(
      userRole.companyId,
      id,
      deliveryId,
    );
    return { success: true };
  }
}
