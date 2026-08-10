import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { PlanGuard } from '#/common/guards/plan.guard';
import { RequirePlan } from '#/common/decorators/require-plan.decorator';
import { RolesGuard } from '#/common/guards/roles.guard';
import { Roles } from '#/common/decorators/roles.decorator';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';
import { TeamRoleType } from '#/common/types/team-role.type';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
@RequirePlan(SubscriptionPlan.PRO)
@Roles(TeamRoleType.OWNER)
@Controller('companies/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.createApiKey(user.companyId!, dto);
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.apiKeysService.listForCompany(user.companyId!);
  }

  @Post(':id/revoke')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.apiKeysService.revokeApiKey(user.companyId!, id);
    return { success: true };
  }
}