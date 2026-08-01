import {TeamRole} from '#/common/types/team-role.type';

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

export interface TeamInviteMemberEventPayload {
  companyId: string;
  inviteEmail: string;
  companyName: string;
  inviterName: string;
  roleLabel: string;
  acceptUrl: string;
}

export interface TeamMemberSuspendedEventPayload {
  companyId: string;
  companyName: string;

  memberId: string;
  memberName: string;
  memberEmail: string;
  roleLabel: TeamRole;

  suspendedAt: Date;

  suspendedByUserId?: string;
  suspendedByName?: string;
}

export interface TeamMemberActivatedEventPayload {
  companyId: string;
  companyName: string;

  memberId: string;
  memberName: string;
  memberEmail: string;
  roleLabel: TeamRole;

  activatedAt: Date;

  activatedByUserId?: string;
  activatedByName?: string;
}

export class TeamMemberActivatedEvent {
  constructor(public readonly payload: TeamMemberActivatedEventPayload) {}
}

export const TEAM_EVENTS = {
  MEMBER_ACCEPTED: 'team.member-accepted',
  INVITE_MEMBER: 'team.invite-member',
  ROLE_CHANGED: 'team.role_changed',
  REMOVED: 'team.removed',
  MEMBER_SUSPENDED: 'team.member-suspended',
  MEMBER_ACTIVATED: 'team.member-activated',
} as const;

export class TeamMemberSuspendedEvent {
  constructor(public readonly payload: TeamMemberSuspendedEventPayload) {}
}

export class TeamMemberAcceptedEvent {
  constructor(public readonly payload: TeamMemberAcceptedEventPayload) {}
}

export class TeamInviteMemberEvent {
  constructor(public readonly payload: TeamInviteMemberEventPayload) {}
}

export class TeamMemberRoleChangedEvent {
  constructor(
    public readonly companyId: string,
    public readonly memberName: string,
    public readonly newRole: string,
  ) {}
}

export class TeamMemberRemovedEvent {
  constructor(
    public readonly companyId: string,
    public readonly memberName: string,
  ) {}
}
