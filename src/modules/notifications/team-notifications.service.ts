import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { MailService } from '#/modules/mail/mail.service';

import { NotificationSetting } from '#/common/entities/notification-setting.entity';

import { OrderStatus } from '#/common/constants/order-status.constant';

import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
} from '#/common/events/order.events';

import {
  TEAM_EMAIL_SETTING_MAP,
  TEAM_TEMPLATE_MAP,
} from './notification-mappings';

import { getTeamOrderSubject } from './notificcation-subjects';
import {
  TeamInviteMemberEvent,
  TeamMemberAcceptedEvent,
} from '#/common/events/team.events';
import { MailTemplate } from '#/modules/mail/interfaces/mail-template.interface';
import { CompanyNotificationSetting } from '#/common/entities/company-notification-settings.entity';

type TeamOrderEvent = OrderCreatedEvent | OrderStatusChangedEvent;

@Injectable()
export class TeamNotificationsService {
  constructor(
    private readonly mailService: MailService,

    @InjectRepository(NotificationSetting)
    private readonly notificationRepo: Repository<NotificationSetting>,

    @InjectRepository(CompanyNotificationSetting)
    private readonly companyNotificationRepo: Repository<CompanyNotificationSetting>,
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
    event: OrderStatusChangedEvent,
  ): Promise<void> {
    await this.sendTeamEmailNotifications(event, event.payload.status);
  }

  async handleTeamMemberAccepted(
    event: TeamMemberAcceptedEvent,
  ): Promise<void> {
    if (!event.payload.recipients.length) {
      return;
    }
    const companySettings = await this.companyNotificationRepo.findOne({
      where: { companyId: event.payload.companyId },
    });

    if (!companySettings || !companySettings.emailTeamMemberJoined) return;

    await Promise.all(
      event.payload.recipients.map((r) =>
        this.sendTeamMemberAcceptedEmail(r.email, event),
      ),
    );
  }

  async handleTeamInviteMember(event: TeamInviteMemberEvent): Promise<void> {
    const { inviterName, companyName, roleLabel, acceptUrl, inviteEmail } =
      event.payload;
    await this.mailService.sendTemplateEmail({
      to: inviteEmail,
      subject: `You've been invited to join ${companyName ?? 'SmartTrack'}`,
      templateName: MailTemplate.TEAM_INVITE,
      context: {
        companyName,
        inviterName,
        roleLabel,
        acceptUrl,
      },
    });
  }

  private async sendTeamMemberAcceptedEmail(
    email: string,
    event: TeamMemberAcceptedEvent,
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

        year: new Date().getFullYear(),
      },
    });
  }

  /**
   * Sends emails to team members based on their notification preferences.
   */
  private async sendTeamEmailNotifications(
    event: TeamOrderEvent,
    status: OrderStatus,
  ): Promise<void> {
    if (!event.payload.teamRecipients?.length) {
      return;
    }

    const notificationSetting = TEAM_EMAIL_SETTING_MAP[status];
    const teamUserIds = event.payload.teamRecipients.map((team) => team.userId);

    const members = await this.notificationRepo.find({
      where: {
        userId: In(teamUserIds),
      },
      relations: {
        userRole: true,
      },
    });

    const emails = members
      .filter((setting) => setting[notificationSetting])
      .map((setting) =>
        this.sendEmail(
          setting.userRole.email,
          setting.userRole.name as string,
          event,
          status,
        ),
      );

    await Promise.all(emails);
  }

  private async sendEmail(
    email: string,
    memberName: string,
    event: TeamOrderEvent,
    status: OrderStatus,
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
          'previousStatus' in event.payload
            ? event.payload.previousStatus
            : undefined,

        updatedBy: event.payload.updatedBy,

        orderUrl: event.payload.orderUrl,
      },
    });
  }
}