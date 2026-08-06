import { OrderLocationEmbed } from "#/common/entities/order-location.embeddable";
import { OrderStatus } from "#/common/constants/order-status.constant";
export class OrderApiResponseDto {
    id: string;
    trackingNumber: string;
    orderReference?: string;
    status: OrderStatus;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    pickupLocation: OrderLocationEmbed;
    dropoffLocation: OrderLocationEmbed;
    items: { name: string; quantity: number }[];
    priority: string;
    scheduledFor?: string;
    createdAt: string;
}
