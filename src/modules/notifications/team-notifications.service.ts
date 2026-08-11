import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { MailService } from "#/modules/mail/mail.service";
import { OrderStatus } from "#/common/constants/order-status.constant";
import {
    OrderCreatedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";
import { TEAM_TEMPLATE_MAP } from "./notification-mappings";
import { getTeamOrderSubject } from "./notificcation-subjects";
import {
    TeamMemberRoleChangedEvent,
    TeamInviteMemberEvent,
    TeamMemberAcceptedEvent,
    TeamMemberActivatedEvent,
    TeamMemberSuspendedEvent
} from "#/common/events/team.events";
import { MailTemplate } from "#/modules/mail/interfaces/mail-template.interface";
import { CompanyNotificationSetting } from "#/common/entities/company-notification-settings.entity";
import {ConfigService} from "@nestjs/config";

type TeamOrderEvent = OrderCreatedEvent | OrderStatusChangedEvent;

/**
 * Masks the local part of an email address, keeping the domain.
 * e.g., "john.doe@gmail.com" → "j***@gmail.com"
 */
function maskEmail(email: string): string {
    const [local, domain] = email.split("@");
    if (!domain) return "***";
    const visible = local.charAt(0);
    return `${visible}***@${domain}`;
}

@Injectable()
export class TeamNotificationsService {
    private readonly logger = new Logger(TeamNotificationsService.name);

    constructor(
        private readonly mailService: MailService,
        private readonly config: ConfigService,
        @InjectRepository(CompanyNotificationSetting)
        private readonly companyNotificationRepo: Repository<CompanyNotificationSetting>
    ) {}

    async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
        try {
            await this.sendTeamEmailNotifications(event, OrderStatus.PENDING);
        } catch (err) {
            this.logger.error({
                msg: `handleOrderCreated failed for company ${event.payload.companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    async handleOrderStatusChanged(
        event: OrderStatusChangedEvent
    ): Promise<void> {
        try {
            await this.sendTeamEmailNotifications(event, event.payload.status);
        } catch (err) {
            this.logger.error({
                msg: `handleOrderStatusChanged failed for company ${event.payload.companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    async handleTeamMemberAccepted(
        event: TeamMemberAcceptedEvent
    ): Promise<void> {
        try {
            if (!event.payload.recipients.length) return;

            const companySettings = await this.getCompanySettings(
                event.payload.companyId
            );
            if (!companySettings || !companySettings.teamEmailEnabled) return;

            await Promise.all(
                event.payload.recipients.map(r =>
                    this.sendTeamMemberAcceptedEmail(r.email, event)
                )
            );
        } catch (err) {
            this.logger.error({
                msg: `handleTeamMemberAccepted failed for company ${event.payload.companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    async handleTeamInviteMember(event: TeamInviteMemberEvent): Promise<void> {
        try {
            const {
                inviterName,
                companyName,
                roleLabel,
                acceptUrl,
                inviteEmail
            } = event.payload;

            await this.mailService.sendTemplateEmail({
                to: inviteEmail,
                subject: `You've been invited to join ${
                    companyName ?? "SmartTrack"
                }`,
                templateName: MailTemplate.TEAM_INVITE,
                context: { companyName, inviterName, roleLabel, acceptUrl }
            });
        } catch (err) {
            this.logger.error({
                msg: `handleTeamInviteMember failed to send invite to ${maskEmail(
                    event.payload.inviteEmail
                )}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    async handleTeamMemberSuspended(
        event: TeamMemberSuspendedEvent
    ): Promise<void> {
        try {
            const {
                companyId,
                memberEmail,
                memberName,
                companyName,
                suspendedAt
            } = event.payload;

            const companySettings = await this.getCompanySettings(companyId);
            if (!companySettings?.teamEmailEnabled) return;

            await this.mailService.sendTemplateEmail({
                to: memberEmail,
                subject: `Your access to ${
                    companyName ?? "SmartTrack"
                } has been suspended`,
                templateName: MailTemplate.TEAM_MEMBER_SUSPENDED,
                context: {
                    companyName: companyName ?? "SmartTrack",
                    memberName,
                    suspendedAt: suspendedAt.toLocaleString(),
                    year: new Date().getFullYear()
                }
            });
        } catch (err) {
            this.logger.error({
                msg: `handleTeamMemberSuspended failed for company ${event.payload.companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    async handleTeamMemberActivated(
        event: TeamMemberActivatedEvent
    ): Promise<void> {
        try {
            const {
                companyId,
                memberEmail,
                memberName,
                companyName,
                activatedAt
            } = event.payload;

            const companySettings = await this.getCompanySettings(companyId);
            if (!companySettings?.teamEmailEnabled) return;

            await this.mailService.sendTemplateEmail({
                to: memberEmail,
                subject: `Your access to ${
                    companyName ?? "SmartTrack"
                } has been restored`,
                templateName: MailTemplate.TEAM_MEMBER_ACTIVATED,
                context: {
                    companyName: companyName ?? "SmartTrack",
                    memberName,
                    activatedAt: activatedAt.toLocaleString(),
                    year: new Date().getFullYear()
                }
            });
        } catch (err) {
            this.logger.error({
                msg: `handleTeamMemberActivated failed for company ${event.payload.companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    async handleTeamMemberRoleChanged(
        event: TeamMemberRoleChangedEvent
    ): Promise<void> {
        try {
            const { companyId, memberName, newRole, memberEmail } = event;

            const companySettings = await this.getCompanySettings(companyId);
            if (!companySettings?.teamEmailEnabled) return;

            const company = await this.companyRepo.findOne({
                where: { id: companyId },
                select: {
                    name: true,
                    email: true
                }
            });
            const companyName = company?.name ?? "SmartTrack";
            const teamUrl = `${this.config.get("CLIENT_URL")}/dashboard/team`;
            const supportEmail = company.email;

            await this.mailService.sendTemplateEmail({
                to: memberEmail,
                subject: `Your role at ${companyName} has been changed`,
                templateName: MailTemplate.TEAM_MEMBER_ROLE_CHANGED,
                context: {
                    companyName,
                    memberName,
                    memberEmail,
                    newRole,
                    teamUrl,
                    supportEmail,
                    year: new Date().getFullYear()
                }
            });
        } catch (err) {
            this.logger.error({
                msg: `handleTeamMemberRoleChanged failed for company ${event.companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    // ---------- Private helpers ----------

    private async sendTeamMemberAcceptedEmail(
        email: string,
        event: TeamMemberAcceptedEvent
    ): Promise<void> {
        try {
            await this.mailService.sendTemplateEmail({
                to: email,
                subject: `${event.payload.memberName} joined ${event.payload.companyName}`,
                templateName: MailTemplate.TEAM_MEMBER_ACCEPTED,
                context: {
                    companyName: event.payload.companyName,
                    memberName: event.payload.memberName,
                    memberEmail: event.payload.memberEmail,
                    roleLabel: event.payload.roleLabel,
                    joinedAt: event.payload.joinedAt.toLocaleString(),
                    teamUrl: event.payload.teamUrl,
                    year: new Date().getFullYear()
                }
            });
        } catch (err) {
            this.logger.error({
                msg: `Failed to send member accepted email to ${maskEmail(
                    email
                )}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    private async sendTeamEmailNotifications(
        event: TeamOrderEvent,
        status: OrderStatus
    ): Promise<void> {
        try {
            if (!event.payload.teamRecipients?.length) return;

            const companySettings = await this.getCompanySettings(
                event.payload.companyId
            );
            if (!companySettings?.teamEmailEnabled) return;

            const emails = event.payload.teamRecipients.map(recipient =>
                this.sendEmail(
                    recipient.email,
                    recipient.name as string,
                    event,
                    status
                )
            );
            await Promise.all(emails);
        } catch (err) {
            this.logger.error({
                msg: `sendTeamEmailNotifications failed for company ${event.payload.companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    private async sendEmail(
        email: string,
        memberName: string,
        event: TeamOrderEvent,
        status: OrderStatus
    ): Promise<void> {
        try {
            await this.mailService.sendTemplateEmail({
                to: email,
                subject: getTeamOrderSubject(
                    status,
                    event.payload.orderReference
                ),
                templateName: TEAM_TEMPLATE_MAP[status],
                context: {
                    companyName: event.payload.companyName,
                    memberName,
                    customerName: event.payload.customerName,
                    orderReference: event.payload.orderReference,
                    statusLabel: event.payload.statusLabel,
                    previousStatus:
                        "previousStatus" in event.payload
                            ? event.payload.previousStatus
                            : undefined,
                    updatedBy: event.payload.updatedBy,
                    orderUrl: event.payload.orderUrl
                }
            });
        } catch (err) {
            this.logger.error({
                msg: `Failed to send team notification email to ${maskEmail(
                    email
                )} for order ${event.payload.orderReference}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    private async getCompanySettings(
        companyId: string
    ): Promise<CompanyNotificationSetting | null> {
        try {
            return await this.companyNotificationRepo.findOne({
                where: { companyId }
            });
        } catch (err) {
            this.logger.error({
                msg: `Failed to fetch company notification settings for ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            return null;
        }
    }
}
