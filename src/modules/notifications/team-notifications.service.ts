import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { MailService } from "#/modules/mail/mail.service";

import { NotificationSetting } from "#/common/entities/notification-setting.entity";

import { OrderStatus } from "#/common/constants/order-status.constant";

import {
    OrderCreatedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";

import {
    TEAM_EMAIL_SETTING_MAP,
    TEAM_TEMPLATE_MAP
} from "./notification-mappings";

import {
    getTeamOrderSubject
} from "./notification-subjects";


type TeamOrderEvent =
    | OrderCreatedEvent
    | OrderStatusChangedEvent;


@Injectable()
export class TeamNotificationsService {
    constructor(
        private readonly mailService: MailService,

        @InjectRepository(NotificationSetting)
        private readonly notificationRepo: Repository<NotificationSetting>
    ) {}


    /**
     * Handle notification when a new order is created.
     */
    async handleOrderCreated(
        event: OrderCreatedEvent
    ): Promise<void> {

        await this.sendTeamEmailNotifications(
            event,
            OrderStatus.PENDING
        );
    }


    /**
     * Handle notification when order status changes.
     */
    async handleOrderStatusChanged(
        event: OrderStatusChangedEvent
    ): Promise<void> {

        await this.sendTeamEmailNotifications(
            event,
            event.status
        );
    }


    /**
     * Sends emails to team members based on their notification preferences.
     */
    private async sendTeamEmailNotifications(
        event: TeamOrderEvent,
        status: OrderStatus
    ): Promise<void> {

        if (!event.teamUserIds?.length) {
            return;
        }


        const notificationSetting =
            TEAM_EMAIL_SETTING_MAP[status];


        const members =
            await this.notificationRepo.find({
                where: {
                    userId: In(event.teamUserIds)
                },
                relations: {
                    userRole: true
                }
            });


        const emails = members
            .filter(setting =>
                setting[notificationSetting]
            )
            .map(setting =>
                this.sendEmail(
                    setting.userRole.email,
                    setting.userRole.name,
                    event,
                    status
                )
            );


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

            subject: getTeamOrderSubject(
                status,
                event.orderReference
            ),

            templateName:
                TEAM_TEMPLATE_MAP[status],

            context: {
                companyName: event.companyName,

                memberName,

                customerName:
                    event.customerName,

                orderReference:
                    event.orderReference,

                statusLabel:
                    event.statusLabel,

                previousStatus:
                    "previousStatus" in event
                        ? event.previousStatus
                        : undefined,

                updatedBy:
                    event.updatedBy,

                orderUrl:
                    event.orderUrl
            }
        });
    }
}