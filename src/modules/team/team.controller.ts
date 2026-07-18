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
    UseGuards
} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { UsersService } from "#/modules/users/users.service";
import { TeamService } from "./team.service";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { ChangeRoleDto } from "./dto/change-role.dto";
import { ListTeamMembersQueryDto } from "./dto/list-team-members.query.dto";
import { AcceptInviteDto } from "#/modules/team/dto/accept-invite.dto";

const user = {
    id: "d141a507-5cd4-4dfc-8009-0e6ce1cf2524"
};
@Controller("team")
export class TeamController {
    constructor(
        private readonly teamService: TeamService,
        private readonly usersService: UsersService
    ) {}

    @UseGuards(SupabaseAuthGuard)
    @Post("invite")
    async inviteMember(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: InviteMemberDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        await this.teamService.inviteMember(userRole.companyId, user.id, dto);

        return { success: true };
    }

    @Post("accept-invite")
    async acceptInvite(@Body() dto: AcceptInviteDto) {
        return this.teamService.acceptInvite(dto);
    }

    @UseGuards(SupabaseAuthGuard)
    @Post(":memberId/resend-invite")
    async resendInvite(
        @CurrentUser() user: AuthenticatedUser,
        @Param("memberId", ParseUUIDPipe) memberId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        await this.teamService.resendInvite(
            userRole.companyId,
            user.id,
            memberId
        );
        return { success: true };
    }

    @Get("invite/:token")
    async getInvite(@Param("token") token: string) {
        return this.teamService.getInviteByToken(token);
    }

    @UseGuards(SupabaseAuthGuard)
    @Get()
    async listMembers(
        @CurrentUser() user: AuthenticatedUser,
        @Query() query: ListTeamMembersQueryDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.teamService.listTeamMembersForCompany(
            userRole.companyId,
            query
        );
    }
    @UseGuards(SupabaseAuthGuard)
    @Get("drivers/available")
    async listAvailableDrivers(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.teamService.listAvailableDrivers(userRole.companyId);
    }

    @UseGuards(SupabaseAuthGuard)
    @Delete(":memberId/invite")
    async cancelInvite(
        @CurrentUser() user: AuthenticatedUser,
        @Param("memberId", ParseUUIDPipe) memberId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        await this.teamService.cancelInvite(
            userRole.companyId,
            user.id,
            memberId
        );
        return { success: true };
    }

    @UseGuards(SupabaseAuthGuard)
    @Patch(":memberId/role")
    async changeRole(
        @CurrentUser() user: AuthenticatedUser,
        @Param("memberId", ParseUUIDPipe) memberId: string,
        @Body() dto: ChangeRoleDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        await this.teamService.changeMemberRole(
            userRole.companyId,
            user.id,
            memberId,
            dto
        );
        return { success: true };
    }

    @UseGuards(SupabaseAuthGuard)
    @Delete(":memberId")
    async removeMember(
        @CurrentUser() user: AuthenticatedUser,
        @Param("memberId", ParseUUIDPipe) memberId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        await this.teamService.removeMember(
            userRole.companyId,
            user.id,
            memberId
        );
        return { success: true };
    }
}
