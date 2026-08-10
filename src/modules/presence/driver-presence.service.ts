import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import Redis from "ioredis";
import { DriverPresenceStatus } from "#/common/constants/driver-presence.constant";
import {
    DRIVER_PRESENCE_EVENTS,
    DriverOnlineEvent,
    DriverOfflineEvent
} from "#/common/events/driver-presence.events";

const PRESENCE_TTL_SECONDS = 90;
const OFFLINE_GRACE_MS = 15_000;

export type PresenceRecord = {
    status: DriverPresenceStatus;
    lastSeenAt: string;
};

@Injectable()
export class DriverPresenceService {
    private readonly logger = new Logger(DriverPresenceService.name);
    private readonly redis: Redis;
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

        // Log Redis connection errors so they don't go unnoticed
        this.redis.on("error", err => {
            this.logger.error({
                msg: "Redis connection error",
                err: err.message,
                stack: err.stack
            });
        });
    }

    async setOnline(
        companyId: string,
        driverUserId: string,
        driverName: string
    ): Promise<void> {
        // Cancel any pending offline timer — this is a reconnect within the grace window
        const pending = this.pendingOffline.get(driverUserId);
        if (pending) {
            clearTimeout(pending);
            this.pendingOffline.delete(driverUserId);
            return;
        }

        try {
            const wasAlreadyOnline = await this.isOnline(
                companyId,
                driverUserId
            );
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
        } catch (err) {
            this.logger.error({
                msg: `Failed to set driver ${driverUserId} online for company ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            // Rethrow so the gateway can respond appropriately (e.g., disconnect the socket)
            throw err;
        }
    }

    async heartbeat(companyId: string, driverUserId: string): Promise<void> {
        try {
            const key = this.presenceKey(companyId, driverUserId);
            const exists = await this.redis.exists(key);
            if (exists) await this.redis.expire(key, PRESENCE_TTL_SECONDS);
        } catch (err) {
            this.logger.error({
                msg: `Heartbeat failed for driver ${driverUserId} in company ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            // No rethrow – heartbeat failure shouldn’t break the socket loop
        }
    }

    scheduleOffline(
        companyId: string,
        driverUserId: string,
        driverName: string,
        hasActiveStops: () => Promise<boolean>
    ): void {
        const timeout = setTimeout(async () => {
            this.pendingOffline.delete(driverUserId);
            try {
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
            } catch (err) {
                this.logger.error({
                    msg: `Failed to process offline for driver ${driverUserId} in company ${companyId}`,
                    err: (err as Error).message,
                    stack: (err as Error).stack
                });
                // No further action – event will be lost, but the TTL will eventually clean up
            }
        }, OFFLINE_GRACE_MS);

        this.pendingOffline.set(driverUserId, timeout);
    }

    async isOnline(companyId: string, driverUserId: string): Promise<boolean> {
        try {
            const record = await this.getRecord(companyId, driverUserId);
            return record?.status === DriverPresenceStatus.ONLINE;
        } catch (err) {
            // If we can't check, assume offline – safe fallback
            this.logger.error({
                msg: `Failed to check online status for driver ${driverUserId} in company ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            return false;
        }
    }

    async getRecord(
        companyId: string,
        driverUserId: string
    ): Promise<PresenceRecord | null> {
        try {
            const raw = await this.redis.get(
                this.presenceKey(companyId, driverUserId)
            );
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            this.logger.error({
                msg: `Failed to get presence record for driver ${driverUserId} in company ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            return null; // safe fallback
        }
    }

    async listOnlineDriverIds(companyId: string): Promise<Set<string>> {
        try {
            const keys = await this.redis.keys(
                this.presenceKey(companyId, "*")
            );
            if (keys.length === 0) return new Set();
            const ids = keys.map(key => key.split(":").pop()!);
            return new Set(ids);
        } catch (err) {
            this.logger.error({
                msg: `Failed to list online drivers for company ${companyId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            return new Set(); // no drivers will be returned (safe)
        }
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
