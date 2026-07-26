import { TeamRole } from '#/common/types/team-role.type';

export type TeamNotificationRecipient = {
  userId: string;
  email: string;
  name: string;
  role: TeamRole;
};

export interface TeamMemberAcceptedEventPayload {
  companyId: string;
  companyName: string;

  memberId: string;
  memberName: string;
  memberEmail: string;
  roleLabel: TeamRole;

  joinedAt: Date;

  teamUrl: string;

  recipients: TeamNotificationRecipient[];
}
export const TEAM_EVENTS = {
  MEMBER_ACCEPTED: 'team.member.accepted',
} as const;

export class TeamMemberAcceptedEvent {
  constructor(public readonly payload: TeamMemberAcceptedEventPayload) {}
}
