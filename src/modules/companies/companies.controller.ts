import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { FastifyRequest } from 'fastify';
import { FileValidationPipe } from '#/common/pipes/file-validation.pipe';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @UseGuards(SupabaseAuthGuard)
  @Post('register')
  async registerCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.companiesService.createCompany(dto, user.id);
  }

  @Get(':companyId')
  async findCompany(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companiesService.getCompanyById(companyId);
  }

  @Patch(':companyId')
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

  // Future changes here ( Delete all users who are in this company when company is deleted)
  @Delete(':companyId')
  async removeCompany(@Param('companyId', ParseUUIDPipe) companyId: string) {
    await this.companiesService.deleteCompany(companyId);
    return { success: true };
  }
}
