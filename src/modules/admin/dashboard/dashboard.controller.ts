import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminDashboardService } from "./dashboard.service";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";

@UseGuards(AdminAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller("admin/dashboard")
export class AdminDashboardController {
    constructor(
        private readonly adminDashboardService: AdminDashboardService
    ) {}

    @Get("stats")
    async getStats() {
        return this.adminDashboardService.getStats();
    }
}
