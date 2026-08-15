import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    Req,
    UseGuards
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminAdminsService } from "./admins.service";
import { ListAdminsDto } from "./dto/list-admins.dto";
import { InviteAdminDto } from "./dto/invite-admin.dto";
import { AcceptAdminInviteDto } from "./dto/accept-admin-invite.dto";
import { UpdateAdminDto } from "./dto/update-admin.dto";
import { ResendAdminInviteDto } from "./dto/resend-admin-invite.dto";
import { UpdateOwnProfileDto } from "./dto/update-own-profile.dto";
import { FileValidationPipe } from "#/common/pipes/file-validation.pipe";
import { ListAdminInvitesDto } from "./dto/list-admin-invites.dto";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";

@PublicThrottle()
@Controller("admin/admins")
export class AdminAdminsController {
    constructor(private readonly adminAdminsService: AdminAdminsService) {}

    // Public invite acceptance (no guard)
    @Post("accept-invite")
    async acceptAdminInvite(@Body() dto: AcceptAdminInviteDto) {
        return this.adminAdminsService.acceptAdminInvite(dto);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Post("invite")
    async inviteAdmin(@Body() dto: InviteAdminDto, @Req() req: FastifyRequest) {
        const inviterUserId = (req as any).adminUser.userId;
        return this.adminAdminsService.inviteAdmin(dto, inviterUserId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Post("resend-invite")
    async resendAdminInvite(
        @Body() dto: ResendAdminInviteDto,
        @Req() req: FastifyRequest
    ) {
        const inviterUserId = (req as any).adminUser.userId;
        return this.adminAdminsService.resendAdminInvite(dto, inviterUserId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Get()
    async listAdmins(@Query() dto: ListAdminsDto) {
        return this.adminAdminsService.listAdmins(dto);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Get("invites")
    async listAdminInvites(@Query() dto: ListAdminInvitesDto) {
        return this.adminAdminsService.listAdminInvites(dto);
    }

    // Authenticated admin routes below
    @Get("me")
    async getMe(@Req() req: FastifyRequest) {
        const adminUser = (req as any).adminUser;
        return this.adminAdminsService.getMe(adminUser.userId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Patch(":id")
    async updateAdmin(
        @Param("id", ParseUUIDPipe) adminId: string,
        @Body() dto: UpdateAdminDto
    ) {
        return this.adminAdminsService.updateAdmin(adminId, dto);
    }

    @UseGuards(AdminAuthGuard)
    @Patch("me")
    async updateOwnProfile(@Req() request: FastifyRequest) {
        const adminUser = (request as any).adminUser;
        const userId = adminUser.userId;

        if (!request.isMultipart()) {
            const dto = request.body as UpdateOwnProfileDto;
            return this.adminAdminsService.updateOwnProfile(userId, dto);
        }

        const parts = request.parts();
        let dto: Partial<UpdateOwnProfileDto> = {};
        let avatarFile:
            | { buffer: Buffer; contentType: string; extension: string }
            | undefined;

        for await (const part of parts) {
            if (part.type === "file" && part.fieldname === "avatar") {
                const buffer = await part.toBuffer();
                const validated = new FileValidationPipe({
                    allowedMimeTypes: new Set([
                        "image/png",
                        "image/jpeg",
                        "image/webp"
                    ]),
                    maxSizeBytes: 2 * 1024 * 1024
                }).transform({
                    file: part,
                    buffer
                });
                const extension =
                    validated.file.filename.split(".").pop() ?? "png";
                avatarFile = {
                    buffer: validated.buffer,
                    contentType: validated.file.mimetype,
                    extension
                };
            } else if (part.type === "field") {
                (dto as Record<string, unknown>)[part.fieldname] = part.value;
            }
        }

        return this.adminAdminsService.updateOwnProfile(
            userId,
            dto as UpdateOwnProfileDto,
            avatarFile
        );
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Post(":id/suspend")
    async suspendAdmin(@Param("id", ParseUUIDPipe) adminId: string) {
        return this.adminAdminsService.suspendAdmin(adminId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Post(":id/reactivate")
    async reactivateAdmin(@Param("id", ParseUUIDPipe) adminId: string) {
        return this.adminAdminsService.reactivateAdmin(adminId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Delete(":id")
    async removeAdmin(@Param("id", ParseUUIDPipe) adminId: string) {
        return this.adminAdminsService.removeAdmin(adminId);
    }

    @UseGuards(AdminAuthGuard, SuperAdminGuard)
    @Delete("invites/:inviteId")
    async cancelAdminInvite(
        @Param("inviteId", ParseUUIDPipe) inviteId: string
    ) {
        return this.adminAdminsService.cancelAdminInvite(inviteId);
    }
}
