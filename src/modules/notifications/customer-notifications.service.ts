import { Injectable } from "@nestjs/common";

import { MailService } from "#/modules/mail/mail.service";
import { MailTemplate } from "#/modules/mail/interfaces/mail-template.interface";

import { CompanyNotificationSetting } from "#/common/entities/company-notification-setting.entity";
import { OrderStatus } from "#/common/constants/order-status.constant";

import {
    CUSTOMER_EMAIL_SETTING_MAP,
    CUSTOMER_TEMPLATE_MAP
} from "./notification-mappings";

import {
    getCustomerOrderSubject
} from "./notification-subjects";

import {
    OrderCreatedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";


type CustomerOrderEvent =
    | OrderCreatedEvent
    | OrderStatusChangedEvent;


@Injectable()
export class CustomerNotificationsService {
    constructor(
        private readonly mailService: MailService
    ) {}


    /**
     * Handle customer notification for order created.
     */
    async handleOrderCreated(
        event: OrderCreatedEvent,
        settings: CompanyNotificationSetting
    ): Promise<void> {
        await this.sendEmailNotification(
            event,
            settings,
            OrderStatus.PENDING
        );
    }


    /**
     * Handle customer notification for status changes.
     */
    async handleOrderStatusChanged(
        event: OrderStatusChangedEvent,
        settings: CompanyNotificationSetting
    ): Promise<void> {
        await this.sendEmailNotification(
            event,
            settings,
            event.status
        );
    }


    /**
     * Sends customer email notification.
     */
    private async sendEmailNotification(
        event: CustomerOrderEvent,
        settings: CompanyNotificationSetting,
        status: OrderStatus
    ): Promise<void> {

        if (!event.customerEmail) {
            return;
        }


        /**
         * Check global customer email switch
         */
        if (!settings.customerEmailEnabled) {
            return;
        }


        /**
         * Check event specific notification switch
         */
        const notificationSetting =
            CUSTOMER_EMAIL_SETTING_MAP[status];


        if (!settings[notificationSetting]) {
            return;
        }


        const template =
            CUSTOMER_TEMPLATE_MAP[status];


        await this.mailService.sendTemplateEmail({
            to: event.customerEmail,

            subject: getCustomerOrderSubject(
                status,
                event.orderReference
            ),

            templateName: template,

            context: {
                companyName: event.companyName,
                customerName: event.customerName,
                orderReference: event.orderReference,
                statusLabel: event.statusLabel,
                trackingUrl: event.trackingUrl,
                supportEmail: event.supportEmail
            }
        });
    }
}