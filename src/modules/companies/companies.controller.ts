import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { RolesGuard } from '#/common/guards/roles.guard';
import { PlanGuard } from '#/common/guards/plan.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import { Roles } from '#/common/decorators/roles.decorator';
import { RequirePlan } from '#/common/decorators/require-plan.decorator';
import { FileValidationPipe } from '#/common/pipes/file-validation.pipe';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { TeamRoleType } from '#/common/types/team-role.type';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';

import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateSavedLocationDto } from './dto/create-saved-location.dto';
import { UpdateSavedLocationDto } from './dto/update-saved-location.dto';
import { UpdateCompanyNotificationDto } from './dto/update-company-notification.dto';
import { OptionalAuthGuard } from '#/common/guards/optional-auth.guard';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @UseGuards(OptionalAuthGuard)
  @Post('register')
  async registerCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.companiesService.createCompany(dto, user.id);
  }

  @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
  @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Post('saved-locations')
  async createSavedLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSavedLocationDto,
  ) {
    return this.companiesService.createSavedLocation(user.companyId!, dto);
  }

  @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
  @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Get('saved-locations')
  async listSavedLocations(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.listSavedLocations(user.companyId!);
  }

  @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
  @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Get('saved-locations/:savedLocationId')
  async getSavedLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('savedLocationId', ParseUUIDPipe) savedLocationId: string,
  ) {
    return this.companiesService.getSavedLocation(
      user.companyId!,
      savedLocationId,
    );
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Get('notification-settings')
  async getCompanyNotification(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.getCompanyNotification(user.companyId!);
  }

  // Public endpoint – no guard required.
  @Get(':companyId')
  async findCompany(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companiesService.getCompanyById(companyId);
  }

  @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
  @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Patch('saved-locations/:savedLocationId')
  async updateSavedLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('savedLocationId', ParseUUIDPipe) savedLocationId: string,
    @Body() dto: UpdateSavedLocationDto,
  ) {
    return this.companiesService.updateSavedLocation(
      user.companyId!,
      savedLocationId,
      dto,
    );
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Patch('notification-settings')
  async updateCompanyNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCompanyNotificationDto,
  ) {
    return this.companiesService.updateCompanyNotification(
      user.companyId!,
      dto,
    );
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Patch(':companyId')
  async updateCompany(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Req() request: FastifyRequest,
  ) {
    // Support both JSON and multipart updates (logo upload).
    if (!request.isMultipart()) {
      const dto = request.body as UpdateCompanyDto;
      return this.companiesService.updateCompany(companyId, dto);
    }

    const parts = request.parts();
    let dto: Partial<UpdateCompanyDto> = {};
    let logoFile:
      { buffer: Buffer; contentType: string; extension: string } | undefined;

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'logo') {
        const buffer = await part.toBuffer();
        const validated = new FileValidationPipe({
          allowedMimeTypes: new Set(['image/png', 'image/jpeg', 'image/webp']),
          maxSizeBytes: 2 * 1024 * 1024,
        }).transform({
          file: part,
          buffer,
        });
        const extension = validated.file.filename.split('.').pop() ?? 'png';
        logoFile = {
          buffer: validated.buffer,
          contentType: validated.file.mimetype,
          extension,
        };
      } else if (part.type === 'field') {
        (dto as Record<string, unknown>)[part.fieldname] = part.value;
      }
    }

    return this.companiesService.updateCompany(
      companyId,
      dto as UpdateCompanyDto,
      logoFile,
    );
  }

  @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
  @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Delete('saved-locations/:savedLocationId')
  async deleteSavedLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('savedLocationId', ParseUUIDPipe) savedLocationId: string,
  ) {
    await this.companiesService.deleteSavedLocation(
      user.companyId!,
      savedLocationId,
    );
    return { success: true };
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER)
  @Delete(':companyId')
  async removeCompany(@Param('companyId', ParseUUIDPipe) companyId: string) {
    await this.companiesService.deleteCompany(companyId);
    return { success: true };
  }
}
