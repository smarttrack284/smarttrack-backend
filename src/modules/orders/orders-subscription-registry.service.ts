import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { ListOrdersQueryDto } from "./dto/list-orders.query.dto";

const SUBSCRIPTION_TTL_SECONDS = 10 * 60; // refreshed on every subscribe; a stale entry that somehow survives a missed disconnect self-expires rather than lingering forever

/**
 * Redis-backed, not in-memory — this is what makes cross-instance delivery
 * actually correct, not just theoretically routable. Whichever instance
 * handles a mutating request (and thus fires the local EventEmitter2
 * listener) needs to see EVERY subscribed socket for that company,
 * including ones connected to a different instance. An in-memory Map only
 * ever knows about sockets on its own process.
 *
 * Two keys per subscription:
 *   - a hash per company (socketId -> serialized query), for "give me
 *     everyone watching this company"
 *   - a reverse string per socket (socketId -> companyId), for O(1)
 *     cleanup on disconnect without needing to know the company already
 *
 * TTL is a safety net, not the primary cleanup path — handleDisconnect
 * still explicitly removes entries. This bounds how long a query string
 * (the plaintext-in-memory concern) can outlive a connection that was
 * cleaned up incorrectly (crash, missed disconnect event, etc.).
 */
@Injectable()
export class OrdersSubscriptionRegistry {
    private readonly redis: Redis;

    constructor(config: ConfigService) {
        const redisUrl = config.get<string>("REDIS_URL");
        if (!redisUrl) throw new Error("REDIS_URL is not configured");
        this.redis = new Redis(redisUrl);
    }

    async set(
        socketId: string,
        companyId: string,
        query: ListOrdersQueryDto
    ): Promise<void> {
        const companyKey = this.companyKey(companyId);
        const reverseKey = this.reverseKey(socketId);

        const pipeline = this.redis.multi();
        pipeline.hset(companyKey, socketId, JSON.stringify(query));
        pipeline.expire(companyKey, SUBSCRIPTION_TTL_SECONDS);
        pipeline.set(reverseKey, companyId, "EX", SUBSCRIPTION_TTL_SECONDS);
        await pipeline.exec();
    }

    /** Looks up which company a socket belongs to without the caller needing to already know — used by handleDisconnect, which only has the socketId. */
    async remove(socketId: string): Promise<void> {
        const reverseKey = this.reverseKey(socketId);
        const companyId = await this.redis.get(reverseKey);
        if (!companyId) return;

        const pipeline = this.redis.multi();
        pipeline.hdel(this.companyKey(companyId), socketId);
        pipeline.del(reverseKey);
        await pipeline.exec();
    }

    async getForCompany(
        companyId: string
    ): Promise<Array<{ socketId: string; query: ListOrdersQueryDto }>> {
        const entries = await this.redis.hgetall(this.companyKey(companyId));
        return Object.entries(entries).map(([socketId, raw]) => ({
            socketId,
            query: JSON.parse(raw) as ListOrdersQueryDto
        }));
    }

    private companyKey(companyId: string): string {
        return `orders:subs:company:${companyId}`;
    }

    private reverseKey(socketId: string): string {
        return `orders:subs:socket:${socketId}`;
    }
}
