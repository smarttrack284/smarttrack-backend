import { Injectable } from '@nestjs/common';

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
  constructor(private readonly mailService: MailService) {}

  /**
   * Handle customer notification for order created.
   */
  async handleOrderCreated(
    event: OrderCreatedEvent,
    settings: CompanyNotificationSetting,
  ): Promise<void> {
    await this.sendEmailNotification(event, settings, OrderStatus.PENDING);
  }

  /**
   * Handle customer notification for status changes.
   */
  async handleOrderStatusChanged(
    event: OrderStatusChangedEvent,
    settings: CompanyNotificationSetting,
  ): Promise<void> {
    await this.sendEmailNotification(event, settings, event.payload.status);
  }

  /**
   * Sends customer email notification.
   */
  private async sendEmailNotification(
    event: CustomerOrderEvent,
    settings: CompanyNotificationSetting,
    status: OrderStatus,
  ): Promise<void> {
    if (!event.payload.customerEmail) {
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
    const notificationSetting = CUSTOMER_EMAIL_SETTING_MAP[status];

    if (!settings[notificationSetting]) {
      return;
    }

    const template = CUSTOMER_TEMPLATE_MAP[status];

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
  }
}