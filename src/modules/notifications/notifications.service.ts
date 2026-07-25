import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { OnEvent } from "@nestjs/event-emitter";
import { Repository } from "typeorm";

import { CompanyNotificationSetting } from "#/common/entities/company-notification-setting.entity";

import {
    ORDER_EVENTS,
    OrderCreatedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";

import { CustomerNotificationsService } from "./customer-notifications.service";
import { TeamNotificationsService } from "./team-notifications.service";

@Injectable()
export class NotificationsService {
    constructor(
        private readonly customerNotificationsService: CustomerNotificationsService,

        private readonly teamNotificationsService: TeamNotificationsService,

        @InjectRepository(CompanyNotificationSetting)
        private readonly companyNotificationRepo: Repository<CompanyNotificationSetting>
    ) {}

    /**
     * New order created
     */
    @OnEvent(ORDER_EVENTS.CREATED)
    async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
        const companySettings = await this.getCompanyNotificationSettings(
            event.companyId
        );

        if (!companySettings) {
            return;
        }

        await Promise.all([
            this.customerNotificationsService.handleOrderCreated(
                event,
                companySettings
            ),

            this.teamNotificationsService.handleOrderCreated(event)
        ]);
    }

    /**
     * Order status changed
     */
    @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
    async handleOrderStatusChanged(
        event: OrderStatusChangedEvent
    ): Promise<void> {
        const companySettings = await this.getCompanyNotificationSettings(
            event.companyId
        );

        if (!companySettings) {
            return;
        }

        await Promise.all([
            this.customerNotificationsService.handleOrderStatusChanged(
                event,
                companySettings
            ),

            this.teamNotificationsService.handleOrderStatusChanged(event)
        ]);
    }

    /**
     * Future events
     *
     * These can be enabled when you introduce
     * separate event names instead of only STATUS_CHANGED.
     */

    @OnEvent(ORDER_EVENTS.ASSIGNED)
    async handleOrderAssigned(event: OrderStatusChangedEvent): Promise<void> {
        await this.handleOrderStatusChanged(event);
    }

    @OnEvent(ORDER_EVENTS.PICKED_UP)
    async handleOrderPickedUp(event: OrderStatusChangedEvent): Promise<void> {
        await this.handleOrderStatusChanged(event);
    }

    @OnEvent(ORDER_EVENTS.DELIVERED)
    async handleOrderDelivered(event: OrderStatusChangedEvent): Promise<void> {
        await this.handleOrderStatusChanged(event);
    }

    @OnEvent(ORDER_EVENTS.FAILED)
    async handleOrderFailed(event: OrderStatusChangedEvent): Promise<void> {
        await this.handleOrderStatusChanged(event);
    }

    @OnEvent(ORDER_EVENTS.CANCELLED)
    async handleOrderCancelled(event: OrderStatusChangedEvent): Promise<void> {
        await this.handleOrderStatusChanged(event);
    }

    private async getCompanyNotificationSettings(
        companyId: string
    ): Promise<CompanyNotificationSetting | null> {
        return this.companyNotificationRepo.findOne({
            where: {
                companyId
            }
        });
    }
}
