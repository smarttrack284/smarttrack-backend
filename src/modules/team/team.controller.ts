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

@UseGuards(SupabaseAuthGuard)
@Controller("team")
export class TeamController {
    constructor(
        private readonly teamService: TeamService,
        private readonly usersService: UsersService
    ) {}

    @Post("invite")
    async inviteMember(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: InviteMemberDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.teamService.inviteMember(userRole.companyId, user.id, dto);
    }

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

    @Post(":memberId/resend-invite")
    async resendInvite(
        @CurrentUser() user: AuthenticatedUser,
        @Param("memberId", ParseUUIDPipe) memberId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.teamService.resendInvite(
            userRole.companyId,
            user.id,
            memberId
        );
    }

    @Patch(":memberId/role")
    async changeRole(
        @CurrentUser() user: AuthenticatedUser,
        @Param("memberId", ParseUUIDPipe) memberId: string,
        @Body() dto: ChangeRoleDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.teamService.changeMemberRole(
            userRole.companyId,
            user.id,
            memberId,
            dto
        );
    }

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
