import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '#/modules/mail/mail.service';
import { CompanyNotificationSetting } from '#/common/entities/company-notification-settings.entity';
import { OrderStatus } from '#/common/constants/order-status.constant';
import {
  CUSTOMER_EMAIL_SETTING_MAP,
  CUSTOMER_TEMPLATE_MAP,
} from './notification-mappings';
import { getCustomerOrderSubject } from './notificcation-subjects';
import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
} from '#/common/events/order.events';

type CustomerOrderEvent = OrderCreatedEvent | OrderStatusChangedEvent;

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
    // No customer email → nothing to do
    if (!event.payload.customerEmail) {
      return;
    }

    // Global customer email switch is off
    if (!settings.customerEmailEnabled) {
      return;
    }

    // Specific notification setting for this status is off
    const notificationSetting = CUSTOMER_EMAIL_SETTING_MAP[status];
    if (!settings[notificationSetting]) {
      return;
    }

    const template = CUSTOMER_TEMPLATE_MAP[status];

    try {
      await this.mailService.sendTemplateEmail({
        to: event.payload.customerEmail,
        subject: getCustomerOrderSubject(status, event.payload.orderReference),
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
      // Non‑critical – log the full error, but never crash the caller
      this.logger.error(
        `Failed to send "${template}" email to ${event.payload.customerEmail}`,
        (err as Error).stack,
      );
    }
  }
}