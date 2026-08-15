import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Req,
    UseGuards,
    Delete
} from "@nestjs/common";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminUsersService } from "./users.service";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";
import { ListUsersDto } from "#/modules/admin/users/dto/list-users.dto";
import { FastifyRequest } from "fastify";

@PublicThrottle()
@Controller("admin/users")
export class AdminUsersController {
    constructor(private readonly adminUsersService: AdminUsersService) {}

    @UseGuards(AdminAuthGuard)
    @Get()
    async listUsers(@Query() dto: ListUsersDto) {
        return this.adminUsersService.listUsers(dto);
    }

    @UseGuards(AdminAuthGuard)
    @Get(":userId")
    async getUserDetail(@Param("userId", ParseUUIDPipe) userId: string) {
        return this.adminUsersService.getUserDetail(userId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Post(":userId/suspend")
    async suspendUser(
        @Param("userId", ParseUUIDPipe) userId: string,
        @Req() req: FastifyRequest
    ) {
        const adminUserId = (req as any).adminUser.userId;
        return this.adminUsersService.suspendUser(userId, adminUserId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Post(":userId/reactivate")
    async reactivateUser(
        @Param("userId", ParseUUIDPipe) userId: string,
        @Req() req: FastifyRequest
    ) {
        const adminUserId = (req as any).adminUser.userId;
        return this.adminUsersService.reactivateUser(userId, adminUserId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Delete(":userId")
    async removeUser(
        @Param("userId", ParseUUIDPipe) userId: string,
        @Req() req: FastifyRequest
    ) {
        const adminUserId = (req as any).adminUser.userId;
        return this.adminUsersService.removeUser(userId, adminUserId);
    }
}
