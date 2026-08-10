import { Injectable, Logger } from "@nestjs/common";
import { MailService } from "#/modules/mail/mail.service";
import { CompanyNotificationSetting } from "#/common/entities/company-notification-settings.entity";
import { OrderStatus } from "#/common/constants/order-status.constant";
import {
    CUSTOMER_EMAIL_SETTING_MAP,
    CUSTOMER_TEMPLATE_MAP,
} from "./notification-mappings";
import { getCustomerOrderSubject } from "./notificcation-subjects";
import {
    OrderCreatedEvent,
    OrderStatusChangedEvent,
} from "#/common/events/order.events";

type CustomerOrderEvent = OrderCreatedEvent | OrderStatusChangedEvent;

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
export class CustomerNotificationsService {
    private readonly logger = new Logger(CustomerNotificationsService.name);

    constructor(private readonly mailService: MailService) {}

    async handleOrderCreated(
        event: OrderCreatedEvent,
        settings: CompanyNotificationSetting,
    ): Promise<void> {
        await this.sendEmailNotification(event, settings, OrderStatus.PENDING);
    }

    async handleOrderStatusChanged(
        event: OrderStatusChangedEvent,
        settings: CompanyNotificationSetting,
    ): Promise<void> {
        await this.sendEmailNotification(event, settings, event.payload.status);
    }

    private async sendEmailNotification(
        event: CustomerOrderEvent,
        settings: CompanyNotificationSetting,
        status: OrderStatus,
    ): Promise<void> {
        if (!event.payload.customerEmail) return;
        if (!settings.customerEmailEnabled) return;

        const notificationSetting = CUSTOMER_EMAIL_SETTING_MAP[status];
        if (!settings[notificationSetting]) return;

        const template = CUSTOMER_TEMPLATE_MAP[status];

        try {
            await this.mailService.sendTemplateEmail({
                to: event.payload.customerEmail,
                subject: getCustomerOrderSubject(
                    status,
                    event.payload.orderReference,
                ),
                templateName: template,
                context: {
                    companyName: event.payload.companyName,
                    customerName: event.payload.customerName,
                    orderReference: event.payload.orderReference,
                    statusLabel: event.payload.statusLabel,
                    trackingUrl: event.payload.trackingUrl,
                    supportEmail: event.payload.supportEmail,
                },
            });
        } catch (err) {
            // Non‑critical – log with masked email and full error details
            this.logger.error({
                msg: `Failed to send "${template}" email to ${maskEmail(event.payload.customerEmail)}`,
                err: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                template,
                orderReference: event.payload.orderReference,
            });
        }
    }
}