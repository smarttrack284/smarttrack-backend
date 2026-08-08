import { Injectable, Logger } from "@nestjs/common";
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
    OrdersBulkImportedEvent,
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
    TeamInviteMemberEvent,
    TeamMemberAcceptedEvent,
    TeamMemberRemovedEvent,
    TeamMemberRoleChangedEvent
} from "#/common/events/team.events";
import {
    API_KEY_EVENTS,
    ApiKeyCreatedEvent,
    ApiKeyRevokedEvent
} from "#/common/events/api-key.events";
import {
    DRIVER_PRESENCE_EVENTS,
    DriverOfflineEvent,
    DriverOnlineEvent
} from "#/common/events/driver-presence.events";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { getPlanFeatures } from "#/common/constants/subscription-plan.constant";
import { ErrorHandlerService } from "#/common/errors/error-handler.service";
import { rule } from "#/common/errors/error-handler.service";
import { InternalErrorException } from "#/common/exceptions";
import { QueryFailedError } from "typeorm";
import { OrderStatus } from "#/common/constants/order-status.constant";
import {ListActivityLogQueryDto} from "./dto/list-activity-log.query.dto"

@Injectable()
export class ActivityLogService {
    private readonly logger = new Logger(ActivityLogService.name);

    constructor(
        @InjectRepository(ActivityLog)
        private readonly repo: Repository<ActivityLog>,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly errorHandler: ErrorHandlerService
    ) {}

    /**
     * Records an activity log entry.
     *
     * If the company's subscription plan does not include activity logs,
     * the call is silently ignored. Any database error is caught, logged,
     * and swallowed – the event listeners that call this are fire‑and‑forget
     * and must never crash the event loop.
     */
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
        try {
            const subscription =
                await this.subscriptionsService.getSubscriptionByCompanyId(
                    input.companyId
                );
            const features = getPlanFeatures(subscription.plan);

            if (!features.activityLog) return;

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
        } catch (err) {
            // Activity logging is non‑critical; a failure must not break
            // the business operation that triggered the event.
            this.logger.error(
                `Failed to record activity log for company ${
                    input.companyId
                }: ${err instanceof Error ? err.message : err}`,
                err instanceof Error ? err.stack : undefined
            );
        }
    }

    // --- Event listeners (unchanged, safe because `record` never throws) ---

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

    @OnEvent(STOP_EVENTS.ARRIVED)
    handleStopArrived(event: StopArrivedEvent) {
        void this.record({
            companyId: event.companyId,
            category: ActivityCategory.DRIVER,
            eventType: "driver.arrived",
            message: `Arrived — ${event.customerName}
            (#${event.orderReference}), arrived on ${event.arrivedAt}`
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
        try {
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
        } catch (err) {
            this.errorHandler.handle(err, "ActivityLogService.listForCompany", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to retrieve activity log at this time. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

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
