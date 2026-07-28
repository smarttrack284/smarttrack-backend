import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OnEvent } from "@nestjs/event-emitter";
import { ActivityLog } from "#/common/entities/activity-log.entity";
import {
    ActivityCategory,
    ActivitySeverity
} from "#/common/constants/activity-log.constant";
import {
    ORDER_EVENTS,
    OrderCreatedEvent,
    OrderDeletedEvent,
    OrderStatusChangedEvent,
    OrdersBulkImportedEvent
} from "#/common/events/order.events";
import {
    STOP_EVENTS,
    StopArrivedEvent,
    StopCompletedEvent,
    StopSkippedEvent
} from "#/common/events/stop.events";
import {
    TEAM_EVENTS,
    TeamInviteMemberEvent,
    TeamMemberAcceptedEvent,
    TeamMemberRemovedEvent,
    TeamMemberRoleChangedEvent
} from "#/common/events/team.events";
import { OrderStatus } from "#/common/constants/order-status.constant";
import type { ListActivityLogQueryDto } from "./dto/list-activity-log.query.dto";
import {
    API_KEY_EVENTS,
    ApiKeyCreatedEvent,
    ApiKeyRevokedEvent
} from "#/common/events/api-key.events";
import {
    DRIVER_PRESENCE_EVENTS,
    DriverOnlineEvent,
    DriverOfflineEvent
} from "#/common/events/driver-presence.events";

@Injectable()
export class ActivityLogService {
    constructor(
        @InjectRepository(ActivityLog)
        private readonly repo: Repository<ActivityLog>
    ) {}

    async record(input: {
        companyId: string;
        category: ActivityCategory;
        eventType: string;
        severity?: ActivitySeverity;
        message: string;
        metadata?: Record<string, unknown>;
        actorUserId?: string | null;
        actorName?: string | null;
    }): Promise<void> {
        const log = this.repo.create({
            companyId: input.companyId,
            category: input.category,
            eventType: input.eventType,
            severity: input.severity ?? ActivitySeverity.INFO,
            message: input.message,
            metadata: input.metadata ?? null,
            actorUserId: input.actorUserId ?? null,
            actorName: input.actorName ?? null
        });
        await this.repo.save(log);
    }

    // --- Listeners: translate domain events into log rows ---

    /* Orders  Listeners */

    @OnEvent(ORDER_EVENTS.CREATED)
    handleOrderCreated(event: OrderCreatedEvent) {
        void this.record({
            companyId: event.payload.companyId,
            category: ActivityCategory.ORDER,
            eventType: "order.created",
            message: "A new order was created"
        });
    }

    @OnEvent(ORDER_EVENTS.STATUS_CHANGED)
    handleOrderStatusChanged(event: OrderStatusChangedEvent) {
        const severity =
            event.payload.currentStatus === OrderStatus.FAILED
                ? ActivitySeverity.CRITICAL
                : event.payload.currentStatus === OrderStatus.CANCELLED
                ? ActivitySeverity.WARNING
                : ActivitySeverity.INFO;

        void this.record({
            companyId: event.payload.companyId,
            category: ActivityCategory.ORDER,
            eventType: `order.${event.payload.currentStatus}`,
            severity,
            message: `Order status changed from ${event.payload.previousStatus} to ${event.payload.currentStatus}`,
            metadata: { orderId: event.payload.orderId }
        });
    }

    @OnEvent(ORDER_EVENTS.DELETED)
    handleOrderDeleted(event: OrderDeletedEvent) {
        void this.record({
            companyId: event.payload.companyId,
            category: ActivityCategory.ORDER,
            eventType: "order.deleted",
            severity: ActivitySeverity.WARNING,
            message: "An order was deleted"
        });
    }

    @OnEvent(ORDER_EVENTS.BULK_IMPORTED)
    handleOrdersBulkImported(event: OrdersBulkImportedEvent) {
        const hasFailures = event.failedCount > 0;

        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.ORDER,
            eventType: "order.bulk_imported",
            // WARNING rather than INFO when some rows failed — a partially-failed
            // import is worth a dispatcher's attention in the activity feed, not
            // just a routine success entry indistinguishable from a single order
            // creation.
            severity: hasFailures
                ? ActivitySeverity.WARNING
                : ActivitySeverity.INFO,
            message: hasFailures
                ? `Imported ${event.importedCount} orders from CSV — ${event.failedCount} row(s) failed`
                : `Imported ${event.importedCount} orders from CSV`,
            metadata: {
                importedCount: event.importedCount,
                failedCount: event.failedCount
            }
        });
    }

    /* Dispatch  Listeners */

    @OnEvent(STOP_EVENTS.ARRIVED)
    handleStopArrived(event: StopArrivedEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.DRIVER,
            eventType: "driver.arrived",
            message: `Arrived — ${event.customerName} (#${event.orderReference})`
        });
    }

    @OnEvent(STOP_EVENTS.COMPLETED)
    handleStopCompleted(event: StopCompletedEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.DRIVER,
            eventType: "driver.delivered",
            message: `Delivered — ${event.customerName} (#${event.orderReference})`
        });
    }

    @OnEvent(STOP_EVENTS.SKIPPED)
    handleStopSkipped(event: StopSkippedEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.DRIVER,
            eventType: "driver.skipped",
            severity: ActivitySeverity.WARNING,
            message: `Skipped — ${event.customerName} (#${event.orderReference}): ${event.reason}`
        });
    }
    /* Team  Listeners */

    @OnEvent(TEAM_EVENTS.INVITE_MEMBER)
    handleTeamInvited(event: TeamInviteMemberEvent) {
        void this.record({
            companyId: event.payload.companyId,
            category: ActivityCategory.TEAM,
            eventType: "team.invited",
            message: `${event.payload.inviteEmail} was invited as ${event.payload.roleLabel}`
        });
    }

    @OnEvent(TEAM_EVENTS.MEMBER_ACCEPTED)
    handleTeamJoined(event: TeamMemberAcceptedEvent) {
        void this.record({
            companyId: event.payload.companyId,
            category: ActivityCategory.TEAM,
            eventType: "team.joined",
            message: `${event.payload.memberName} joined the team`
        });
    }

    @OnEvent(TEAM_EVENTS.ROLE_CHANGED)
    handleTeamRoleChanged(event: TeamMemberRoleChangedEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.TEAM,
            eventType: "team.role_changed",
            message: `${event.memberName}'s role changed to ${event.newRole}`
        });
    }

    @OnEvent(TEAM_EVENTS.REMOVED)
    handleTeamRemoved(event: TeamMemberRemovedEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.TEAM,
            eventType: "team.removed",
            severity: ActivitySeverity.WARNING,
            message: `${event.memberName} was removed from the team`
        });
    }

    /* API key Listeners */

    @OnEvent(API_KEY_EVENTS.CREATED)
    handleApiKeyCreated(event: ApiKeyCreatedEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.API_KEY,
            eventType: "api_key.created",
            message: `API key "${event.keyName}" was created`
        });
    }

    @OnEvent(API_KEY_EVENTS.REVOKED)
    handleApiKeyRevoked(event: ApiKeyRevokedEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.API_KEY,
            eventType: "api_key.revoked",
            severity: ActivitySeverity.WARNING,
            message: `API key "${event.keyName}" was revoked`
        });
    }

    /* Driver events Listeners*/

    @OnEvent(DRIVER_PRESENCE_EVENTS.ONLINE)
    handleDriverOnline(event: DriverOnlineEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.DRIVER,
            eventType: "driver.online",
            message: `${event.driverName} went online`
        });
    }

    @OnEvent(DRIVER_PRESENCE_EVENTS.OFFLINE)
    handleDriverOffline(event: DriverOfflineEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.DRIVER,
            eventType: "driver.offline",
            // WARNING specifically when they had unresolved stops — this is the
            // real trigger point for the frontend's already-defined
            // emailDriverOffline notification preference, which previously had
            // no event anywhere in the codebase to actually fire from.
            severity: event.hadActiveStops
                ? ActivitySeverity.WARNING
                : ActivitySeverity.INFO,
            message: event.hadActiveStops
                ? `${event.driverName} went offline with active stops still pending`
                : `${event.driverName} went offline`
        });
    }

    // --- Reads ---

    async listForCompany(companyId: string, query: ListActivityLogQueryDto) {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;

        const qb = this.repo
            .createQueryBuilder("log")
            .where("log.companyId = :companyId", { companyId });

        if (query.categories?.length) {
            qb.andWhere("log.category IN (:...categories)", {
                categories: query.categories
            });
        }
        if (query.severities?.length) {
            qb.andWhere("log.severity IN (:...severities)", {
                severities: query.severities
            });
        }
        if (query.search) {
            qb.andWhere("log.message ILIKE :search", {
                search: `%${query.search}%`
            });
        }
        if (query.dateFrom) {
            qb.andWhere("log.createdAt >= :dateFrom", {
                dateFrom: new Date(query.dateFrom)
            });
        }
        if (query.dateTo) {
            qb.andWhere("log.createdAt <= :dateTo", {
                dateTo: new Date(query.dateTo)
            });
        }

        qb.orderBy("log.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const [logs, total] = await qb.getManyAndCount();

        return {
            events: this.groupAdjacentEvents(logs),
            total,
            page,
            pageSize
        };
    }

    /**
     * "Group events" — adjacent entries (after sorting by time) with the
     * SAME eventType occurring within a 5-minute window are merged into one
     * grouped item with a count, rather than showing "Order created" ten
     * times in a row for a batch import. Applied within the current page
     * only — grouping across page boundaries would require a more complex
     * windowed query and isn't worth the complexity at this scale.
     */
    private groupAdjacentEvents(logs: ActivityLog[]) {
        const GROUP_WINDOW_MS = 5 * 60_000;
        const grouped: Array<{
            id: string;
            category: ActivityCategory;
            eventType: string;
            severity: ActivitySeverity;
            message: string;
            count: number;
            firstAt: string;
            lastAt: string;
        }> = [];

        for (const log of logs) {
            const last = grouped[grouped.length - 1];
            const withinWindow =
                last &&
                last.eventType === log.eventType &&
                new Date(last.lastAt).getTime() - log.createdAt.getTime() <=
                    GROUP_WINDOW_MS;

            if (withinWindow) {
                last.count += 1;
                last.firstAt = log.createdAt.toISOString();
            } else {
                grouped.push({
                    id: log.id,
                    category: log.category,
                    eventType: log.eventType,
                    severity: log.severity,
                    message: log.message,
                    count: 1,
                    firstAt: log.createdAt.toISOString(),
                    lastAt: log.createdAt.toISOString()
                });
            }
        }

        return grouped;
    }
}
