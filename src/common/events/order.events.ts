import { OrderStatus } from '#/common/constants/order-status.constant';

export const ORDER_EVENTS = {
  CREATED: 'order.created',
  ASSIGNED: 'order.assigned',
  PICKED_UP: 'order.picked_up',
  IN_TRANSIT: 'order.in_transit',
  DELIVERED: 'order.delivered',
  FAILED: 'order.failed',
  CANCELLED: 'order.cancelled',
  STATUS_CHANGED: 'order.status_changed',
  DELETED: 'order.deleted',
} as const;

export type TeamNotificationRecipient = {
  userId: string;
  name: string;
  email: string;
};

export interface BaseOrderEventPayload {
  companyId: string;
  companyName: string;

  orderId: string;
  orderReference: string;

  status: OrderStatus;
  statusLabel: string;

  customerName: string;
  customerEmail: string | null;

  trackingUrl: string;
  supportEmail: string;
  orderUrl: string;

  updatedBy: string;
  driverName: string | null;

  teamRecipients: TeamNotificationRecipient[];
}

export class BaseOrderEvent {
  constructor(public readonly payload: BaseOrderEventPayload) {}
}

export class OrderCreatedEvent extends BaseOrderEvent {}

export class OrderAssignedEvent extends BaseOrderEvent {}

export class OrderPickedUpEvent extends BaseOrderEvent {}

export class OrderInTransitEvent extends BaseOrderEvent {}

export class OrderDeliveredEvent extends BaseOrderEvent {}

export class OrderFailedEvent extends BaseOrderEvent {}

export class OrderCancelledEvent extends BaseOrderEvent {}

export interface OrderStatusChangedPayload extends BaseOrderEventPayload {
  previousStatus: OrderStatus;
  currentStatus: OrderStatus;
}

export class OrderStatusChangedEvent {
  constructor(public readonly payload: OrderStatusChangedPayload) {}
}

export interface OrderDeletedPayload {
  companyId: string;
  companyName: string;

  orderId: string;
  orderReference: string;

  customerName: string;

  deletedBy: string;
}

export class OrderDeletedEvent {
  constructor(public readonly payload: OrderDeletedPayload) {}
}
