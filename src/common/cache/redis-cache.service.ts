import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Generic cache-aside helper over Redis — not specific to Overview.
 * getOrSet is the main entry point: return the cached value if present,
 * otherwise compute it, cache it, and return it. Failures reading/writing
 * the cache degrade to "just compute it" rather than breaking the request,
 * since a cache outage should never take down a read endpoint.
 */
@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) throw new Error('REDIS_URL is not configured');
    this.redis = new Redis(redisUrl);
  }

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return JSON.parse(cached) as T;
    } catch (err) {
      this.logger.warn(
        `Cache read failed for ${key}: ${err instanceof Error ? err.message : err}`,
      );
    }

    const fresh = await compute();

    try {
      await this.redis.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(
        `Cache write failed for ${key}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return fresh;
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.redis.del(...keys);
  }
}
