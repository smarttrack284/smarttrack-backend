import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { ListOrdersQueryDto } from "./dto/list-orders.query.dto";

const SUBSCRIPTION_TTL_SECONDS = 10 * 60;

@Injectable()
export class OrdersSubscriptionRegistry {
    private readonly logger = new Logger(OrdersSubscriptionRegistry.name);
    private readonly redis: Redis;

    constructor(config: ConfigService) {
        const redisUrl = config.get<string>("REDIS_URL");
        if (!redisUrl) throw new Error("REDIS_URL is not configured");
        this.redis = new Redis(redisUrl);

        // Log Redis connection errors so they don't go unnoticed
        this.redis.on("error", err => {
            this.logger.error({
                msg: "Redis connection error",
                stack: err.stack,
                err: err.message
            });
        });
    }

    async set(
        socketId: string,
        companyId: string,
        query: ListOrdersQueryDto
    ): Promise<void> {
        const companyKey = this.companyKey(companyId);
        const reverseKey = this.reverseKey(socketId);

        try {
            const pipeline = this.redis.multi();
            pipeline.hset(companyKey, socketId, JSON.stringify(query));
            pipeline.expire(companyKey, SUBSCRIPTION_TTL_SECONDS);
            pipeline.set(reverseKey, companyId, "EX", SUBSCRIPTION_TTL_SECONDS);
            const results = await pipeline.exec();
            // Optionally inspect for errors
            results?.forEach(([err]) => {
                if (err) {
                    this.logger.error(
                        `Pipeline error in set for socket ${socketId}`,
                        err.stack
                    );
                }
            });
        } catch (err) {
            this.logger.error({
                msg: `Failed to set subscription for socket ${socketId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            // Re-throw so the gateway can decide how to handle it
            throw err;
        }
    }

    async remove(socketId: string): Promise<void> {
        const reverseKey = this.reverseKey(socketId);
        try {
            const companyId = await this.redis.get(reverseKey);
            if (!companyId) return;

            const pipeline = this.redis.multi();
            pipeline.hdel(this.companyKey(companyId), socketId);
            pipeline.del(reverseKey);
            const results = await pipeline.exec();
            results?.forEach(([err]) => {
                if (err) {
                    this.logger.error({
                        msg: `Pipeline error in remove for socket ${socketId}`,
                        err: err.message,
                        stack: err.stack
                    });
                }
            });
        } catch (err) {
            this.logger.error(
                `Failed to remove subscription for socket ${socketId}`,
                (err as Error).stack
            );
            // Swallow? It’s a cleanup operation – probably best to not crash
        }
    }

    async getForCompany(
        companyId: string
    ): Promise<Array<{ socketId: string; query: ListOrdersQueryDto }>> {
        try {
            const entries = await this.redis.hgetall(
                this.companyKey(companyId)
            );
            return Object.entries(entries).map(([socketId, raw]) => ({
                socketId,
                query: JSON.parse(raw as string) as ListOrdersQueryDto
            }));
        } catch (err) {
            this.logger.error(
              {
                msg: `Failed to get subscriptions for company ${companyId}`,
               err: (err as Error).message,
               stack: (err as Error).stack,
          }  );
            // Return empty – the event simply won’t be pushed to any socket,
            // which is safer than crashing the event loop
            return [];
        }
    }

    private companyKey(companyId: string): string {
        return `orders:subs:company:${companyId}`;
    }

    private reverseKey(socketId: string): string {
        return `orders:subs:socket:${socketId}`;
    }
}
