import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { FileValidationPipe } from "#/common/pipes/file-validation.pipe";
import { UsersService } from "./users.service";
import { UpdateUserProfileDto } from "./dto/update-user-profile.dto";
import { UpdatePasswordDto } from "./dto/update-password.dto";
// import { UpdateNotificationSettingsDto } from "#/modules/users/dto/update-notification-settings.dto";
//

@UseGuards(SupabaseAuthGuard)
@Controller("users/me")
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Patch("profile")
    async updateProfile(
        @CurrentUser() user: AuthenticatedUser,
        @Req() request: FastifyRequest
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);

        if (!request.isMultipart()) {
            const dto = request.body as UpdateUserProfileDto;
            return this.usersService.updateUserProfile(
                user.id,
                userRole.companyId,
                dto
            );
        }

        const parts = request.parts();
        let dto: Partial<UpdateUserProfileDto> = {};
        let avatarFile:
            | { buffer: Buffer; contentType: string; extension: string }
            | undefined;

        for await (const part of parts) {
            if (part.type === "file" && part.fieldname === "avatar") {
                const buffer = await part.toBuffer();
                const validated = new FileValidationPipe().transform({
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

        return this.usersService.updateUserProfile(
            user.id,
            userRole.companyId,
            dto as UpdateUserProfileDto,
            avatarFile
        );
    }

    @Patch("password")
    async updatePassword(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: UpdatePasswordDto
    ) {
        await this.usersService.updatePassword(user.id, user.email, dto);
        return { success: true };
    }

    //   @Patch('notification-settings')
    //   async updateNotificationSettings(
    //     @CurrentUser() user: AuthenticatedUser,
    //     @Body() dto: UpdateNotificationSettingsDto,
    //   ) {
    //     await this.usersService.getUserRoleByUserId(user.id);
    //     return this.usersService.updateNotificationSettings(user.id, dto);
    //   }
    //
    //   @Get('notification-settings')
    //   async getNotificationSettings(@CurrentUser() user: AuthenticatedUser) {
    //     await this.usersService.getUserRoleByUserId(user.id);
    //     return this.usersService.getNotificationSettings(user.id);
    //   }
    //
    /**
     * The single source of truth for "does this signed-in user have a
     * company yet." Used by the frontend login flow AND the /register and
     * /dashboard route guards — all three must agree, or a user could pass
     * one check and fail another. Returns hasCompany: false rather than a
     * 404 when no UserRole exists, since "not onboarded yet" is an
     * expected, valid state for a freshly signed-up user, not an error.
     */
    @Get("status")
    async getAccountStatus(@CurrentUser() user: AuthenticatedUser) {
        try {
            const userRole = await this.usersService.getUserRoleByUserId(
                user.id
            );
            return {
                hasCompany: true,
                companyId: userRole.companyId,
                role: userRole.role,
                name: userRole.name
            };
        } catch {
            // No UserRole row anywhere for this user — they signed up but never
            // completed company registration (or their invite was never
            // accepted). This is the exact case this whole feature protects
            // against.
            return {
                hasCompany: false,
                companyId: null,
                role: null,
                name: null
            };
        }
    }
}
