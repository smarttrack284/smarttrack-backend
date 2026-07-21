import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { ListTripsQueryDto } from "./dto/list-trips.query.dto";

const SUBSCRIPTION_TTL_SECONDS = 10 * 60;

/** Redis-backed, same cross-instance-correctness reasoning as OrdersSubscriptionRegistry — see that file's comments for the full explanation, not repeated here. */
@Injectable()
export class TripsSubscriptionRegistry {
    private readonly redis: Redis;

    constructor(config: ConfigService) {
        const redisUrl = config.get<string>("REDIS_URL");
        if (!redisUrl) throw new Error("REDIS_URL is not configured");
        this.redis = new Redis(redisUrl);
    }

    async set(
        socketId: string,
        companyId: string,
        query: ListTripsQueryDto
    ): Promise<void> {
        const companyKey = this.companyKey(companyId);
        const reverseKey = this.reverseKey(socketId);
        const pipeline = this.redis.multi();
        pipeline.hset(companyKey, socketId, JSON.stringify(query));
        pipeline.expire(companyKey, SUBSCRIPTION_TTL_SECONDS);
        pipeline.set(reverseKey, companyId, "EX", SUBSCRIPTION_TTL_SECONDS);
        await pipeline.exec();
    }

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
    ): Promise<Array<{ socketId: string; query: ListTripsQueryDto }>> {
        const entries = await this.redis.hgetall(this.companyKey(companyId));
        return Object.entries(entries).map(([socketId, raw]) => ({
            socketId,
            query: JSON.parse(raw)
        }));
    }

    private companyKey(companyId: string): string {
        return `trips:subs:company:${companyId}`;
    }
    private reverseKey(socketId: string): string {
        return `trips:subs:socket:${socketId}`;
    }
}
