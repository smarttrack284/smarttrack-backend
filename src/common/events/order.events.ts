import { OrderStatus } from "#/common/constants/order-status.constant";

export const ORDER_EVENTS = {
    CREATED: "order.created",
    ASSIGNED: "order.assigned",
    PICKED_UP: "order.picked_up",
    IN_TRANSIT: "order.in_transit",
    DELIVERED: "order.delivered",
    FAILED: "order.failed",
    CANCELLED: "order.cancelled",
    STATUS_CHANGED: "order.status_changed",
    DELETED: "order.deleted"
} as const;

export class OrderCreatedEvent {
    constructor(public readonly companyId: string) {}
}

export class OrderStatusChangedEvent {
    constructor(
        public readonly companyId: string,
        public readonly orderId: string,
        public readonly fromStatus: OrderStatus,
        public readonly toStatus: OrderStatus
    ) {}
}

export class OrderDeletedEvent {
    constructor(public readonly companyId: string) {}
}
