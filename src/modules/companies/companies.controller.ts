import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, } from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { FastifyRequest } from 'fastify';
import { FileValidationPipe } from '#/common/pipes/file-validation.pipe';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UsersService } from '#/modules/users/users.service';
import { CreateSavedLocationDto } from './dto/create-saved-location.dto';
import { UpdateSavedLocationDto } from './dto/update-saved-location.dto';
import { Roles } from '#/common/decorators/roles.decorator';
import { RolesGuard } from '#/common/guards/roles.guard';
import { TeamRoleType } from '#/common/types/team-role.type';

@UseGuards(SupabaseAuthGuard, RolesGuard)
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  @Roles() // Anyone
  async registerCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.companiesService.createCompany(dto, user.id);
  }

  @Post('api-keys')
  @Roles(TeamRoleType.OWNER)
  async createApiKey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApiKeyDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.companiesService.createApiKeyForCompany(
      userRole.companyId,
      dto,
    );
  }

  @Post('saved-locations')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async createSavedLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSavedLocationDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);

    return this.companiesService.createSavedLocation(userRole.companyId, dto);
  }

  @Post('api-keys/:apiKeyId/revoke')
  @Roles(TeamRoleType.OWNER)
  async revokeApiKey(
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);

    return this.companiesService.revokeApiKeyForCompany(
      userRole.companyId,
      apiKeyId,
    );
  }

  @Get('saved-locations')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async listSavedLocations(@CurrentUser() user: AuthenticatedUser) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);

    return this.companiesService.listSavedLocations(userRole.companyId);
  }

  @Get('saved-locations/:savedLocationId')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async getSavedLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('savedLocationId', ParseUUIDPipe)
    savedLocationId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);

    return this.companiesService.getSavedLocation(
      userRole.companyId,
      savedLocationId,
    );
  }

  @Get('api-keys')
  @Roles(TeamRoleType.OWNER)
  async listApiKeys(@CurrentUser() user: AuthenticatedUser) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.companiesService.listApiKeysForCompany(userRole.companyId);
  }

  @Get(':companyId')
  @Roles() // Anyone
  async findCompany(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companiesService.getCompanyById(companyId);
  }

  @Patch('saved-locations/:savedLocationId')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async updateSavedLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('savedLocationId', ParseUUIDPipe)
    savedLocationId: string,
    @Body() dto: UpdateSavedLocationDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);

    return this.companiesService.updateSavedLocation(
      userRole.companyId,
      savedLocationId,
      dto,
    );
  }

  @Patch(':companyId')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  async updateCompany(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Req() request: FastifyRequest,
  ) {
    // @fastify/multipart parses either a JSON body OR a multipart body —
    // this endpoint needs to accept both, since a text-only update (name/
    // timezone, no new logo) shouldn't force the client into multipart
    // encoding unnecessarily.
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
        const validated = new FileValidationPipe().transform({
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

  @Delete('saved-locations/:savedLocationId')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async deleteSavedLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('savedLocationId', ParseUUIDPipe)
    savedLocationId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);

    await this.companiesService.deleteSavedLocation(
      userRole.companyId,
      savedLocationId,
    );

    return {
      success: true,
    };
  }

  // Future changes here ( Delete all users who are in this company when company is deleted)
  @Delete(':companyId')
  @Roles(TeamRoleType.OWNER)
  async removeCompany(@Param('companyId', ParseUUIDPipe) companyId: string) {
    await this.companiesService.deleteCompany(companyId);
    return { success: true };
  }
}
