import { SetMetadata } from '@nestjs/common';
import { TeamRoleType } from '#/common/types/team-role.type';

export const ROLES_KEY = 'roles';

/** Attach to a controller method: @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN). Must be paired with @UseGuards(SupabaseAuthGuard, RolesGuard) — RolesGuard reads request.user, which only SupabaseAuthGuard sets. */
export const Roles = (...roles: TeamRoleType[]) => SetMetadata(ROLES_KEY, roles);