import { TeamRoleType } from '#/common/types/team-role.type';

export type AuthenticatedUser = {
  id: string;
  sessionId: string;
  name: string
  email: string;
  companyId: string | null;
  role: TeamRoleType;
  metadata: Record<string, unknown>;
};
