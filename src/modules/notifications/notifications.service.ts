import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { OnEvent } from "@nestjs/event-emitter";
import { Repository } from "typeorm";

import { CompanyNotificationSetting } from "#/common/entities/company-notification-settings.entity";

import {
    ORDER_EVENTS,
    OrderCreatedEvent,
    OrderStatusChangedEvent
} from "#/common/events/order.events";

import { CustomerNotificationsService } from "./customer-notifications.service";
import { TeamNotificationsService } from "./team-notifications.service";
import {
    TEAM_EVENTS,
    TeamInviteMemberEvent,
    TeamMemberAcceptedEvent,
    TeamMemberActivatedEvent,
    TeamMemberSuspendedEvent
} from "#/common/events/team.events";

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        private readonly customerNotificationsService: CustomerNotificationsService,
        private readonly teamNotificationsService: TeamNotificationsService,
        @InjectRepository(CompanyNotificationSetting)
        private readonly companyNotificationRepo: Repository<CompanyNotificationSetting>
    ) {}

    /* ---------- Order events ---------- */

    @OnEvent(ORDER_EVENTS.CREATED)
    async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
        try {
            const companySettings = await this.getCompanyNotificationSettings(
                event.payload.companyId
            );
            if (!companySettings) return;

            await Promise.all([
                this.customerNotificationsService.handleOrderCreated(
                    event,
                    companySettings
                ),
                this.teamNotificationsService.handleOrderCreated(event)
            ]);
        } catch (err) {
            this.logger.error(
                `handleOrderCreated failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
            // Swallow – never crash the event loop
        }
    }

    @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
    async handleOrderStatusChanged(
        event: OrderStatusChangedEvent
    ): Promise<void> {
        try {
            const companySettings = await this.getCompanyNotificationSettings(
                event.payload.companyId
            );
            if (!companySettings) return;

            await Promise.all([
                this.customerNotificationsService.handleOrderStatusChanged(
                    event,
                    companySettings
                ),
                this.teamNotificationsService.handleOrderStatusChanged(event)
            ]);
        } catch (err) {
            this.logger.error(
                `handleOrderStatusChanged failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    @OnEvent(ORDER_EVENTS.ASSIGNED)
    async handleOrderAssigned(event: OrderStatusChangedEvent): Promise<void> {
        try {
            await this.handleOrderStatusChanged(event);
        } catch (err) {
            this.logger.error(
                `handleOrderAssigned failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    @OnEvent(ORDER_EVENTS.PICKED_UP)
    async handleOrderPickedUp(event: OrderStatusChangedEvent): Promise<void> {
        try {
            await this.handleOrderStatusChanged(event);
        } catch (err) {
            this.logger.error(
                `handleOrderPickedUp failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    @OnEvent(ORDER_EVENTS.DELIVERED)
    async handleOrderDelivered(event: OrderStatusChangedEvent): Promise<void> {
        try {
            await this.handleOrderStatusChanged(event);
        } catch (err) {
            this.logger.error(
                `handleOrderDelivered failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    @OnEvent(ORDER_EVENTS.FAILED)
    async handleOrderFailed(event: OrderStatusChangedEvent): Promise<void> {
        try {
            await this.handleOrderStatusChanged(event);
        } catch (err) {
            this.logger.error(
                `handleOrderFailed failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    @OnEvent(ORDER_EVENTS.CANCELLED)
    async handleOrderCancelled(event: OrderStatusChangedEvent): Promise<void> {
        try {
            await this.handleOrderStatusChanged(event);
        } catch (err) {
            this.logger.error(
                `handleOrderCancelled failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    /* ---------- Team events ---------- */

    @OnEvent(TEAM_EVENTS.MEMBER_ACCEPTED)
    async handleTeamMemberAccepted(
        event: TeamMemberAcceptedEvent
    ): Promise<void> {
        try {
            await this.teamNotificationsService.handleTeamMemberAccepted(event);
        } catch (err) {
            this.logger.error(
                `handleTeamMemberAccepted failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    @OnEvent(TEAM_EVENTS.INVITE_MEMBER)
    async handleTeamInviteMember(event: TeamInviteMemberEvent): Promise<void> {
        try {
            await this.teamNotificationsService.handleTeamInviteMember(event);
        } catch (err) {
            this.logger.error(
                `handleTeamInviteMember failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    @OnEvent(TEAM_EVENTS.MEMBER_SUSPENDED)
    async handleTeamMemberSuspended(
        event: TeamMemberSuspendedEvent
    ): Promise<void> {
        try {
            await this.teamNotificationsService.handleTeamMemberSuspended(
                event
            );
        } catch (err) {
            this.logger.error(
                `handleTeamMemberSuspended failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    @OnEvent(TEAM_EVENTS.MEMBER_ACTIVATED)
    async handleTeamMemberActivated(
        event: TeamMemberActivatedEvent
    ): Promise<void> {
        try {
            await this.teamNotificationsService.handleTeamMemberActivated(
                event
            );
        } catch (err) {
            this.logger.error(
                `handleTeamMemberActivated failed for company ${event.payload.companyId}`,
                (err as Error).stack
            );
        }
    }

    /* ---------- Helpers ---------- */

    private async getCompanyNotificationSettings(
        companyId: string
    ): Promise<CompanyNotificationSetting | null> {
        try {
            return await this.companyNotificationRepo.findOne({
                where: { companyId }
            });
        } catch (err) {
            this.logger.error(
                `Failed to load notification settings for company ${companyId}`,
                (err as Error).stack
            );
            return null; // safe fallback: skip all notifications for this company
        }
    }
}
