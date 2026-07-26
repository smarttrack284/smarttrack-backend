import { OrderStatus } from '#/common/constants/order-status.constant';
import { CompanyNotificationSetting } from '#/common/entities/company-notification-settings.entity';
import { NotificationSetting } from '#/common/entities/notification-setting.entity';
import { MailTemplate } from '#/modules/mail/interfaces/mail-template.interface';

/**
 * Maps an order status to the company notification setting
 * that controls customer EMAIL notifications.
 */
export const CUSTOMER_EMAIL_SETTING_MAP: Record<
  OrderStatus,
  keyof CompanyNotificationSetting
> = {
  [OrderStatus.PENDING]: 'customerEmailOrderCreated',
  [OrderStatus.ASSIGNED]: 'customerEmailOrderAssigned',
  [OrderStatus.PICKED_UP]: 'customerEmailOrderPickedUp',
  [OrderStatus.IN_TRANSIT]: 'customerEmailOrderInTransit',
  [OrderStatus.DELIVERED]: 'customerEmailOrderDelivered',
  [OrderStatus.FAILED]: 'customerEmailOrderFailed',
  [OrderStatus.CANCELLED]: 'customerEmailOrderCancelled',
};

/**
 * Maps an order status to the company notification setting
 * that controls customer SMS notifications.
 */
export const CUSTOMER_SMS_SETTING_MAP: Record<
  OrderStatus,
  keyof CompanyNotificationSetting
> = {
  [OrderStatus.PENDING]: 'customerSmsOrderCreated',
  [OrderStatus.ASSIGNED]: 'customerSmsOrderAssigned',
  [OrderStatus.PICKED_UP]: 'customerSmsOrderPickedUp',
  [OrderStatus.IN_TRANSIT]: 'customerSmsOrderInTransit',
  [OrderStatus.DELIVERED]: 'customerSmsOrderDelivered',
  [OrderStatus.FAILED]: 'customerSmsOrderFailed',
  [OrderStatus.CANCELLED]: 'customerSmsOrderCancelled',
};

/**
 * Maps an order status to the team member notification setting.
 */
export const TEAM_EMAIL_SETTING_MAP: Record<
  OrderStatus,
  keyof NotificationSetting
> = {
  [OrderStatus.PENDING]: 'emailOrderCreated',
  [OrderStatus.ASSIGNED]: 'emailOrderAssigned',
  [OrderStatus.PICKED_UP]: 'emailOrderPickedUp',
  [OrderStatus.IN_TRANSIT]: 'emailOrderInTransit',
  [OrderStatus.DELIVERED]: 'emailOrderDelivered',
  [OrderStatus.FAILED]: 'emailOrderFailed',
  [OrderStatus.CANCELLED]: 'emailOrderCancelled',
};

/**
 * Customer email templates.
 */
export const CUSTOMER_TEMPLATE_MAP: Record<OrderStatus, MailTemplate> = {
  [OrderStatus.PENDING]: MailTemplate.ORDER_CREATED,
  [OrderStatus.ASSIGNED]: MailTemplate.ORDER_ASSIGNED,
  [OrderStatus.PICKED_UP]: MailTemplate.ORDER_PICKED_UP,
  [OrderStatus.IN_TRANSIT]: MailTemplate.ORDER_IN_TRANSIT,
  [OrderStatus.DELIVERED]: MailTemplate.ORDER_DELIVERED,
  [OrderStatus.FAILED]: MailTemplate.ORDER_FAILED,
  [OrderStatus.CANCELLED]: MailTemplate.ORDER_CANCELLED,
};

/**
 * Team email templates.
 */
export const TEAM_TEMPLATE_MAP: Record<OrderStatus, MailTemplate> = {
  [OrderStatus.PENDING]: MailTemplate.TEAM_ORDER_CREATED,
  [OrderStatus.ASSIGNED]: MailTemplate.TEAM_ORDER_ASSIGNED,
  [OrderStatus.PICKED_UP]: MailTemplate.TEAM_ORDER_PICKED_UP,
  [OrderStatus.IN_TRANSIT]: MailTemplate.TEAM_ORDER_IN_TRANSIT,
  [OrderStatus.DELIVERED]: MailTemplate.TEAM_ORDER_DELIVERED,
  [OrderStatus.FAILED]: MailTemplate.TEAM_ORDER_FAILED,
  [OrderStatus.CANCELLED]: MailTemplate.TEAM_ORDER_CANCELLED,
};