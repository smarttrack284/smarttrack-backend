import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  /**
   * The frontend's /register page posts here. This is the "a signed-in
   * user with no company yet sets one up" step, distinct from
   * POST /companies below (a generic create, likely for internal/admin
   * use once that exists).
   *
   * TODO — not yet wired: this must be behind an auth guard that verifies
   * the caller's Supabase session, and the resulting company must be
   * linked back to that user as its "owner" (see hasCompletedOnboarding()
   * on the frontend, which currently checks a `profiles.company_id`
   * column that doesn't have a backend entity/migration yet). Once a
   * Profile/TeamMember entity exists, this method should call
   * companiesService.createCompany(dto, manager) and the
   * profile-linking logic INSIDE THE SAME manager/transaction, so a
   * company can never be created without an owner attached, or vice versa.
   */
  @Post('register')
  async register(@Body() dto: CreateCompanyDto) {
    const ownerName = '';
    const ownerUserId = '';
    return this.companiesService.createCompany(dto, ownerUserId, ownerName);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.getCompanyById(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.updateCompany(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.companiesService.deleteCompany(id);
    return { success: true };
  }
}
