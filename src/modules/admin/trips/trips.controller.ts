import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Query,
    UseGuards
} from "@nestjs/common";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";
import { AdminTripsService } from "./trips.service";
import { ListCompanyTripsDto } from "./dto/list-company-trips.dto";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";

@UseGuards(AdminAuthGuard)
@PublicThrottle()
@Controller("admin/companies/:id/trips")
export class AdminTripsController {
    constructor(private readonly adminTripsService: AdminTripsService) {}

    @Get()
    async listTrips(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Query() dto: ListCompanyTripsDto
    ) {
        return this.adminTripsService.listTrips(companyId, dto);
    }
}
