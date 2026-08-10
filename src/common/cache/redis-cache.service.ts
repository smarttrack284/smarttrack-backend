import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) throw new Error('REDIS_URL is not configured');
    this.redis = new Redis(redisUrl);

    // Log Redis connection errors
    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error', err.stack);
    });
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

  /**
   * Simple key lookup — returns the cached value (as a string, or null)
   * without any compute logic.  Logs and returns null on Redis errors.
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.logger.warn(
        `Cache get failed for ${key}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /**
   * Sets a key with an optional TTL (in seconds).  If TTL is omitted, the
   * key is stored without expiry.  Errors are logged but never thrown.
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds !== undefined) {
        await this.redis.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.redis.set(key, value);
      }
    } catch (err) {
      this.logger.warn(
        `Cache set failed for ${key}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.redis.del(...keys);
  }
}
