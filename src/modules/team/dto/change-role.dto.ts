import { IsIn } from "class-validator";
import { TeamRoleType } from "#/common/types/team-role.type";
import { ASSIGNABLE_TEAM_ROLES } from "#/common/constants/team-role.constant";

export class ChangeRoleDto {
    @IsIn(ASSIGNABLE_TEAM_ROLES)
    role: TeamRoleType;
}
