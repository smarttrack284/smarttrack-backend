import { OrderStatus } from "#/common/constants/order-status.constant";

/**
 * Returns the email subject shown to customers.
 */
export function getCustomerOrderSubject(
    status: OrderStatus,
    orderReference: string
): string {
    switch (status) {
        case OrderStatus.PENDING:
            return `We've received your order #${orderReference}`;

        case OrderStatus.ASSIGNED:
            return `Your order #${orderReference} has been assigned`;

        case OrderStatus.PICKED_UP:
            return `Your order #${orderReference} has been picked up`;

        case OrderStatus.DELIVERED:
            return `Your order #${orderReference} has been delivered`;

        case OrderStatus.FAILED:
            return `There was a problem with your order #${orderReference}`;

        case OrderStatus.CANCELLED:
            return `Your order #${orderReference} has been cancelled`;

        default:
            return `Update for order #${orderReference}`;
    }
}

/**
 * Returns the email subject shown to company team members.
 */
export function getTeamOrderSubject(
    status: OrderStatus,
    orderReference: string
): string {
    switch (status) {
        case OrderStatus.PENDING:
            return `New order received (#${orderReference})`;

        case OrderStatus.ASSIGNED:
            return `Order assigned (#${orderReference})`;

        case OrderStatus.PICKED_UP:
            return `Order picked up (#${orderReference})`;

        case OrderStatus.DELIVERED:
            return `Order delivered (#${orderReference})`;

        case OrderStatus.FAILED:
            return `Order failed (#${orderReference})`;

        case OrderStatus.CANCELLED:
            return `Order cancelled (#${orderReference})`;

        default:
            return `Order update (#${orderReference})`;
    }
}