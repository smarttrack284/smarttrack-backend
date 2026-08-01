import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { MailService } from "#/modules/mail/mail.service";

// import { NotificationSetting } from "#/common/entities/notification-setting.entity";

import { OrderStatus } from "#/common/constants/order-status.constant";

import {
    OrderCreatedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";

import {
    TEAM_TEMPLATE_MAP
} from "./notification-mappings";

import { getTeamOrderSubject } from "./notificcation-subjects";
import {
    TeamInviteMemberEvent,
    TeamMemberAcceptedEvent,
    TeamMemberActivatedEvent,
    TeamMemberSuspendedEvent
} from "#/common/events/team.events";
import { MailTemplate } from "#/modules/mail/interfaces/mail-template.interface";
import { CompanyNotificationSetting } from "#/common/entities/company-notification-settings.entity";

type TeamOrderEvent = OrderCreatedEvent | OrderStatusChangedEvent;

@Injectable()
export class TeamNotificationsService {
    constructor(
        private readonly mailService: MailService,


        @InjectRepository(CompanyNotificationSetting)
        private readonly companyNotificationRepo: Repository<CompanyNotificationSetting>
    ) {}

    /**
     * Handle notification when a new order is created.
     */
    async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
        await this.sendTeamEmailNotifications(event, OrderStatus.PENDING);
    }

    /**
     * Handle notification when order status changes.
     */
    async handleOrderStatusChanged(
        event: OrderStatusChangedEvent
    ): Promise<void> {
        await this.sendTeamEmailNotifications(event, event.payload.status);
    }

    async handleTeamMemberAccepted(
        event: TeamMemberAcceptedEvent
    ): Promise<void> {
        if (!event.payload.recipients.length) {
            return;
        }
        const companySettings = await this.companyNotificationRepo.findOne({
            where: { companyId: event.payload.companyId }
        });

        // Master switch check
        if (!companySettings || !companySettings.teamEmailEnabled) {
            return;
        }

        await Promise.all(
            event.payload.recipients.map(r =>
                this.sendTeamMemberAcceptedEmail(r.email, event)
            )
        );
    }

    async handleTeamInviteMember(event: TeamInviteMemberEvent): Promise<void> {
        const { inviterName, companyName, roleLabel, acceptUrl, inviteEmail } =
            event.payload;

        // Note: Invites generally bypass the master switch so you can actually
        // onboard people, but if you want to block invites too, you would add
        // the teamEmailEnabled check here.
        await this.mailService.sendTemplateEmail({
            to: inviteEmail,
            subject: `You've been invited to join ${
                companyName ?? "SmartTrack"
            }`,
            templateName: MailTemplate.TEAM_INVITE,
            context: {
                companyName,
                inviterName,
                roleLabel,
                acceptUrl
            }
        });
    }

    /**
     * Handle notification when a team member is suspended.
     */
    async handleTeamMemberSuspended(
        event: TeamMemberSuspendedEvent
    ): Promise<void> {
        const { companyId, memberEmail, memberName, companyName, suspendedAt } =
            event.payload;

        const companySettings = await this.companyNotificationRepo.findOne({
            where: { companyId }
        });

        // Master switch check
        if (!companySettings || !companySettings.teamEmailEnabled) {
            return;
        }

        // Send notification email to the suspended user informing them of the suspension
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
    }

    /**
     * Handle notification when a team member is reactivated.
     */
    async handleTeamMemberActivated(
        event: TeamMemberActivatedEvent
    ): Promise<void> {
        const { companyId, memberEmail, memberName, companyName, activatedAt } =
            event.payload;

        const companySettings = await this.companyNotificationRepo.findOne({
            where: { companyId }
        });

        // Master switch check
        if (!companySettings || !companySettings.teamEmailEnabled) {
            return;
        }

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
    }

    private async sendTeamMemberAcceptedEmail(
        email: string,
        event: TeamMemberAcceptedEvent
    ): Promise<void> {
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
    }

    /**
     * Sends emails to team members based on their notification preferences.
     */
    private async sendTeamEmailNotifications(
        event: TeamOrderEvent,
        status: OrderStatus
    ): Promise<void> {
        if (!event.payload.teamRecipients?.length) {
            return;
        }
        const companyNotifications = await this.companyNotificationRepo.findOne(
            { where: { companyId: event.payload.companyId } }
        );

        if (!companyNotifications || !companyNotifications.teamEmailEnabled)
            return;

        const emails = event.payload.teamRecipients.map(recipient =>
            this.sendEmail(
                recipient.email,
                recipient.name as string,
                event,
                status
            )
        );
        // const notificationSetting = TEAM_EMAIL_SETTING_MAP[status];
        // const teamUserIds = event.payload.teamRecipients.map((team) => team.userId);

        // const members = await this.notificationRepo.find({
        //   where: {
        //     userId: In(teamUserIds),
        //   },
        //   relations: {
        //     userRole: true,
        //   },
        // });

        // const emails = members
        //   .filter((setting) => setting[notificationSetting])
        //   .map((setting) =>
        //     this.sendEmail(
        //       setting.userRole.email,
        //       setting.userRole.name as string,
        //       event,
        //       status,
        //     ),
        //   );

        await Promise.all(emails);
    }

    private async sendEmail(
        email: string,
        memberName: string,
        event: TeamOrderEvent,
        status: OrderStatus
    ): Promise<void> {
        await this.mailService.sendTemplateEmail({
            to: email,

            subject: getTeamOrderSubject(status, event.payload.orderReference),

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
    }
}
