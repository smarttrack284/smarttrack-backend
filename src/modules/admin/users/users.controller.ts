import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards
} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminUsersService } from "./users.service";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";

@UseGuards(SupabaseAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller("admin/users")
export class AdminUsersController {
    constructor(private readonly adminUsersService: AdminUsersService) {}

    @Get(":userId")
    async getUserDetail(@Param("userId", ParseUUIDPipe) userId: string) {
        return this.adminUsersService.getUserDetail(userId);
    }
}
