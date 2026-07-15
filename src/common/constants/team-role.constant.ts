import { TeamRoleType } from '#/common/types/team-role.type';

/** Owner can't be assigned via invite or change-role — set once, at company creation, never reassigned through this module. */
export const ASSIGNABLE_TEAM_ROLES = Object.values(TeamRoleType).filter(
  (role) => role !== TeamRoleType.OWNER,
);