import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { WebhookEventType } from "#/common/constants/webhook-event.constant";
import { OrderStatus } from "#/common/constants/order-status.constant";
import {
    ORDER_EVENTS,
    OrderCreatedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";
import {
    STOP_EVENTS,
    StopArrivedEvent,
    StopCompletedEvent,
    StopSkippedEvent
} from "#/common/events/stop.events";
import {
    TEAM_EVENTS,
    TeamMemberAcceptedEvent
} from "#/common/events/team.events";
import { WebhooksService } from "./webhooks.service";

@Injectable()
export class WebhooksDispatcherService {
    constructor(private readonly webhooksService: WebhooksService) {}

    @OnEvent(ORDER_EVENTS.CREATED)
    handleOrderCreated(event: OrderCreatedEvent) {
        void this.webhooksService.enqueueDeliveriesForEvent(
            event.payload.companyId,
            WebhookEventType.ORDER_CREATED,
            {
                orderReference: event.payload.orderReference,
                customerName: event.payload.customerName,
                status: event.payload.statusLabel,
                companyId: event.payload.companyId,
                trackingUrl: event.payload.trackingUrl
            }
        );
    }

    @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
    handleOrderStatusChanged(event: OrderStatusChangedEvent) {
        const basePayload = {
            orderReference: event.payload.orderReference,
            fromStatus: event.payload.previousStatus,
            toStatus: event.payload.currentStatus,
            statusLabel: event.payload.statusLabel,
            updatedBy: event.payload.updatedBy,
            companyId: event.payload.companyId
        };

        // Always fire the generic status-changed event
        void this.webhooksService.enqueueDeliveriesForEvent(
            event.payload.companyId,
            WebhookEventType.ORDER_STATUS_CHANGED,
            basePayload
        );

        // Also fire specific lifecycle events for important statuses
        if (event.payload.currentStatus === OrderStatus.DELIVERED) {
            void this.webhooksService.enqueueDeliveriesForEvent(
                event.payload.companyId,
                WebhookEventType.ORDER_DELIVERED,
                basePayload
            );
        } else if (event.payload.currentStatus === OrderStatus.FAILED) {
            void this.webhooksService.enqueueDeliveriesForEvent(
                event.payload.companyId,
                WebhookEventType.ORDER_FAILED,
                basePayload
            );
        }
    }

    @OnEvent(STOP_EVENTS.ARRIVED)
    handleStopArrived(event: StopArrivedEvent) {
        void this.webhooksService.enqueueDeliveriesForEvent(
            event.companyId,
            WebhookEventType.STOP_ARRIVED,
            {
                orderReference: event.orderReference,
                customerName: event.customerName,
                arrivedAt: event.arrivedAt
            }
        );
    }

    @OnEvent(STOP_EVENTS.COMPLETED)
    handleStopCompleted(event: StopCompletedEvent) {
        void this.webhooksService.enqueueDeliveriesForEvent(
            event.companyId,
            WebhookEventType.STOP_COMPLETED,
            {
                orderReference: event.orderReference,
                customerName: event.customerName,
                podMethod: event.podMethod,
                podpodPhotoUrl: event.podPhotoUrl,
                podSignatureUrl: event.podSignatureUrl,
                podNotes: event.podNotes,
                podCapturedAt: event.podCapturedAt
            }
        );
    }

    @OnEvent(STOP_EVENTS.SKIPPED)
    handleStopSkipped(event: StopSkippedEvent) {
        void this.webhooksService.enqueueDeliveriesForEvent(
            event.companyId,
            WebhookEventType.STOP_SKIPPED,
            {
                orderReference: event.orderReference,
                customerName: event.customerName,
                reason: event.reason,
                notes: event.notes,
            }
        );
    }

    @OnEvent(TEAM_EVENTS.MEMBER_ACCEPTED)
    handleTeamJoined(event: TeamMemberAcceptedEvent) {
        void this.webhooksService.enqueueDeliveriesForEvent(
            event.payload.companyId,
            WebhookEventType.TEAM_MEMBER_ACCEPTED,
            {
                memberName: event.payload.memberName,
                memberEmail: event.payload.memberEmail,
                role: event.payload.roleLabel,
                companyName: event.payload.companyName
            }
        );
    }
}
