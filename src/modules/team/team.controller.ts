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
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { UsersService } from '#/modules/users/users.service';
import { TeamService } from './team.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { ListTeamMembersQueryDto } from './dto/list-team-members.query.dto';
import { AcceptInviteDto } from '#/modules/team/dto/accept-invite.dto';
import { Roles } from '#/common/decorators/roles.decorator';
import { TeamRoleType } from '#/common/types/team-role.type';
import { RolesGuard } from '#/common/guards/roles.guard';

@Controller('team')
export class TeamController {
  constructor(
    private readonly teamService: TeamService,
    private readonly usersService: UsersService,
  ) {}

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Post('invite')
  async inviteMember(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.teamService.inviteMember(userRole.companyId, user.id, dto);

    return { success: true };
  }

  @Post('accept-invite')
  async acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.teamService.acceptInvite(dto);
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Post(':memberId/resend-invite')
  async resendInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.teamService.resendInvite(userRole.companyId, user.id, memberId);
    return { success: true };
  }

  @Get('invite/:token')
  async getInvite(@Param('token') token: string) {
    return this.teamService.getInviteByToken(token);
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Get()
  async listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTeamMembersQueryDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.teamService.listTeamMembersForCompany(
      userRole.companyId,
      query,
    );
  }
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Get('drivers/available')
  async listAvailableDrivers(@CurrentUser() user: AuthenticatedUser) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.teamService.listAvailableDriversForCompany(userRole.companyId);
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Delete(':memberId/invite')
  async cancelInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.teamService.cancelInvite(userRole.companyId, user.id, memberId);
    return { success: true };
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Patch(':memberId/role')
  async changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.teamService.changeMemberRole(
      userRole.companyId,
      user.id,
      memberId,
      dto,
    );
    return { success: true };
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Patch(':memberId/suspend')
  async suspendMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.teamService.suspendMember(userRole.companyId, user.id, memberId);
    return { success: true };
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Patch(':memberId/activate')
  async activateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.teamService.activateMember(
      userRole.companyId,
      user.id,
      memberId,
    );
    return { success: true };
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
  @Delete(':memberId')
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.teamService.removeMember(userRole.companyId, user.id, memberId);
    return { success: true };
  }
}
