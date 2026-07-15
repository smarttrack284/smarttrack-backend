import { IsEmail, IsIn } from 'class-validator';
import { TeamRoleType } from '#/common/types/team-role.type';
import { ASSIGNABLE_TEAM_ROLES } from '#/common/constants/team-role.constant';

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsIn(ASSIGNABLE_TEAM_ROLES)
  role: TeamRoleType;
}