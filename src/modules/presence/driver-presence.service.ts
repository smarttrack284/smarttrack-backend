import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import Redis from "ioredis";
import { DriverPresenceStatus } from "#/common/constants/driver-presence.constant";
import {
    DRIVER_PRESENCE_EVENTS,
    DriverOnlineEvent,
    DriverOfflineEvent
} from "#/common/events/driver-presence.events";

const PRESENCE_TTL_SECONDS = 90; // heartbeat safety net — a connection that stops heartbeating without a clean disconnect self-expires rather than showing "online" forever
const OFFLINE_GRACE_MS = 15_000; // a brief disconnect (tunnel, app backgrounded) within this window is NOT reported as offline — only a disconnect that isn't followed by a reconnect within this window is real

export type PresenceRecord = {
    status: DriverPresenceStatus;
    lastSeenAt: string;
};

/**
 * Presence is deliberately Redis-only, not a Postgres column — this is
 * transient runtime/connection state, not a durable business record,
 * same reasoning as OrdersSubscriptionRegistry/TripsSubscriptionRegistry.
 * A server restart or Redis flush losing presence state is acceptable
 * (drivers just reconnect and go back online); losing it should never
 * be treated as data loss the way losing an order or a delivery record
 * would be.
 */
@Injectable()
export class DriverPresenceService {
    private readonly redis: Redis;
    // Pending "go offline" timers, keyed by driverUserId — cancelled if a
    // reconnect/heartbeat arrives before the grace period elapses.
    private readonly pendingOffline = new Map<
        string,
        ReturnType<typeof setTimeout>
    >();

    constructor(
        config: ConfigService,
        private readonly events: EventEmitter2
    ) {
        const redisUrl = config.get<string>("REDIS_URL");
        if (!redisUrl) throw new Error("REDIS_URL is not configured");
        this.redis = new Redis(redisUrl);
    }

    async setOnline(
        companyId: string,
        driverUserId: string,
        driverName: string
    ): Promise<void> {
        const pending = this.pendingOffline.get(driverUserId);
        if (pending) {
            clearTimeout(pending);
            this.pendingOffline.delete(driverUserId);
            return; // this was a reconnect within the grace window — never actually went offline, no event to fire
        }

        const wasAlreadyOnline = await this.isOnline(companyId, driverUserId);
        await this.writeRecord(
            companyId,
            driverUserId,
            DriverPresenceStatus.ONLINE
        );

        if (!wasAlreadyOnline) {
            this.events.emit(
                DRIVER_PRESENCE_EVENTS.ONLINE,
                new DriverOnlineEvent(companyId, driverUserId, driverName)
            );
        }
    }

    /** Refreshes the TTL without changing status or firing events — called on a periodic heartbeat from a connected driver socket. */
    async heartbeat(companyId: string, driverUserId: string): Promise<void> {
        const key = this.presenceKey(companyId, driverUserId);
        const exists = await this.redis.exists(key);
        if (exists) await this.redis.expire(key, PRESENCE_TTL_SECONDS);
    }

    /**
     * Schedules a debounced "go offline" — does NOT flip status
     * immediately. Real disconnect only registers if no reconnect/heartbeat
     * cancels this within OFFLINE_GRACE_MS, which is what prevents brief
     * network blips from flapping a driver's availability (and therefore
     * dispatch eligibility) on and off.
     */
    scheduleOffline(
        companyId: string,
        driverUserId: string,
        driverName: string,
        hasActiveStops: () => Promise<boolean>
    ): void {
        const timeout = setTimeout(async () => {
            this.pendingOffline.delete(driverUserId);
            await this.deleteRecord(companyId, driverUserId);
            const hadActiveStops = await hasActiveStops();
            this.events.emit(
                DRIVER_PRESENCE_EVENTS.OFFLINE,
                new DriverOfflineEvent(
                    companyId,
                    driverUserId,
                    driverName,
                    hadActiveStops
                )
            );
        }, OFFLINE_GRACE_MS);

        this.pendingOffline.set(driverUserId, timeout);
    }

    async isOnline(companyId: string, driverUserId: string): Promise<boolean> {
        const record = await this.getRecord(companyId, driverUserId);
        return record?.status === DriverPresenceStatus.ONLINE;
    }

    async getRecord(
        companyId: string,
        driverUserId: string
    ): Promise<PresenceRecord | null> {
        const raw = await this.redis.get(
            this.presenceKey(companyId, driverUserId)
        );
        return raw ? JSON.parse(raw) : null;
    }

    /** All currently-online driver user IDs for a company — the actual thing TeamService.listAvailableDrivers needs to intersect against. */
    async listOnlineDriverIds(companyId: string): Promise<Set<string>> {
        const keys = await this.redis.keys(this.presenceKey(companyId, "*"));
        if (keys.length === 0) return new Set();
        const ids = keys.map(key => key.split(":").pop()!);
        return new Set(ids);
    }

    private async writeRecord(
        companyId: string,
        driverUserId: string,
        status: DriverPresenceStatus
    ): Promise<void> {
        const record: PresenceRecord = {
            status,
            lastSeenAt: new Date().toISOString()
        };
        await this.redis.set(
            this.presenceKey(companyId, driverUserId),
            JSON.stringify(record),
            "EX",
            PRESENCE_TTL_SECONDS
        );
    }

    private async deleteRecord(
        companyId: string,
        driverUserId: string
    ): Promise<void> {
        await this.redis.del(this.presenceKey(companyId, driverUserId));
    }

    private presenceKey(companyId: string, driverUserId: string): string {
        return `driver:presence:${companyId}:${driverUserId}`;
    }
}
