import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards
} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { CompaniesService } from "./companies.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";

@Controller("companies")
export class CompaniesController {
    constructor(private readonly companiesService: CompaniesService) {}

    @UseGuards(SupabaseAuthGuard)
    @Post("register")
    async registerCompany(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateCompanyDto
    ) {
        return this.companiesService.createCompany(dto, user.id);
    }

    @Get(":companyId")
    async findCompany(@Param("companyId", ParseUUIDPipe) companyId: string) {
        return this.companiesService.getCompanyById(companyId);
    }

    @Patch(":companyId")
    async updateCompany(
        @Param("companyId", ParseUUIDPipe) companyId: string,
        @Body() dto: UpdateCompanyDto
    ) {
        return this.companiesService.updateCompany(companyId, dto);
    }

    // Future changes here ( Delete all users who are in this company when company is deleted)
    @Delete(":companyId")
    async removeCompany(@Param("companyId", ParseUUIDPipe) companyId: string) {
        await this.companiesService.deleteCompany(companyId);
        return { success: true };
    }
}
