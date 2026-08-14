import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Req,
    UseGuards
} from "@nestjs/common";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminUsersService } from "./users.service";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";
import { ListUsersDto } from "#/modules/admin/users/dto/list-users.dto";
import { FastifyRequest } from "fastify";

@UseGuards(AdminAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller("admin/users")
export class AdminUsersController {
    constructor(private readonly adminUsersService: AdminUsersService) {}

    @Get()
    async listUsers(@Query() dto: ListUsersDto) {
        return this.adminUsersService.listUsers(dto);
    }

    @Get(":userId")
    async getUserDetail(@Param("userId", ParseUUIDPipe) userId: string) {
        return this.adminUsersService.getUserDetail(userId);
    }

    @Post(":userId/suspend")
    async suspendUser(
        @Param("userId", ParseUUIDPipe) userId: string,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminUsersService.suspendUser(userId, adminUserId);
    }

    @Post(":userId/reactivate")
    async reactivateUser(
        @Param("userId", ParseUUIDPipe) userId: string,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminUsersService.reactivateUser(userId, adminUserId);
    }
}
