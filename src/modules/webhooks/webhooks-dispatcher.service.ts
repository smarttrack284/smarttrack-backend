import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhookEventType } from '#/common/constants/webhook-event.constant';
import { OrderStatus } from '#/common/constants/order-status.constant';
import { ORDER_EVENTS, OrderCreatedEvent, OrderStatusChangedEvent, } from '#/common/events/order.events';
import { STOP_EVENTS, StopArrivedEvent, StopCompletedEvent, StopSkippedEvent, } from '#/common/events/stop.events';
import { TEAM_EVENTS, TeamMemberAcceptedEvent, } from '#/common/events/team.events';
import { WebhooksService } from './webhooks.service';

/**
 * Translates the app's INTERNAL domain events (used for caching,
 * activity logging, socket broadcasts — implementation details that can
 * change) into the STABLE, versioned public webhook catalog
 * (WebhookEventType). Keeping these separate means renaming or
 * restructuring an internal event never breaks an external integrator's
 * webhook payload shape.
 */
@Injectable()
export class WebhooksDispatcherService {
  constructor(private readonly webhooksService: WebhooksService) {}

  @OnEvent(ORDER_EVENTS.CREATED)
  handleOrderCreated(event: OrderCreatedEvent) {
    void this.webhooksService.enqueueDeliveriesForEvent(
      event.payload.companyId,
      WebhookEventType.ORDER_CREATED,
      {
        companyId: event.payload.companyId,
      },
    );
  }

  @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
  handleOrderStatusChanged(event: OrderStatusChangedEvent) {
    void this.webhooksService.enqueueDeliveriesForEvent(
      event.payload.companyId,
      WebhookEventType.ORDER_STATUS_CHANGED,
      {
        orderId: event.payload.orderId,
        fromStatus: event.payload.previousStatus,
        toStatus: event.payload.currentStatus,
      },
    );

    if (event.payload.currentStatus === OrderStatus.DELIVERED) {
      void this.webhooksService.enqueueDeliveriesForEvent(
        event.payload.companyId,
        WebhookEventType.ORDER_DELIVERED,
        {
          orderId: event.payload.orderId,
        },
      );
    }
    if (event.payload.currentStatus === OrderStatus.FAILED) {
      void this.webhooksService.enqueueDeliveriesForEvent(
        event.payload.companyId,
        WebhookEventType.ORDER_FAILED,
        {
          orderId: event.payload.orderId,
        },
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
      },
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
      },
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
      },
    );
  }

  @OnEvent(TEAM_EVENTS.MEMBER_ACCEPTED)
  handleTeamJoined(event: TeamMemberAcceptedEvent) {
    void this.webhooksService.enqueueDeliveriesForEvent(
      event.payload.companyId,
      WebhookEventType.TEAM_MEMBER_ACCEPTED,
      {
        name: event.payload.memberName,
      },
    );
  }
}
