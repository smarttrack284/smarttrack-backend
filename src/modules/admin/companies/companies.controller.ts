import { Controller, Get, Query, UseGuards ,Param, ParseUUIDPipe,} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminCompaniesService } from "./companies.service";
import { ListCompaniesDto } from "./dto/list-companies.dto";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";
import { GetCompanyDetailDto } from "./dto/get-company-detail.dto";

@UseGuards(SupabaseAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller("admin")
export class AdminCompaniesController {
    constructor(
        private readonly adminCompaniesService: AdminCompaniesService
    ) {}

    @Get("companies")
    async listCompanies(@Query() dto: ListCompaniesDto) {
        return this.adminCompaniesService.listCompanies(dto);
    }

    @Get(":id")
    async getCompanyDetail(
        @Param("id", ParseUUIDPipe) id: string,
        @Query() dto: GetCompanyDetailDto
    ) {
        return this.adminCompaniesService.getCompanyDetail(id, dto);
    }
}
