import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * Redis-backed implementation of Nest's ThrottlerStorage interface — this
 * is the ONLY thing that changes to make every existing/future @Throttle()
 * decorator usage shared across server instances instead of per-process.
 * No new decorator, no new guard — @Throttle() and ThrottlerGuard work
 * exactly as before.
 *
 * Uses a single atomic Lua script (INCR + conditional PEXPIRE) rather than
 * separate round-trips, so concurrent requests against the same key can
 * never race past the limit due to a read-then-write gap.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis: Redis;

  // KEYS[1] = counter key
  // ARGV[1] = ttl in ms
  // Returns the post-increment count.
  private readonly incrementScript = `
    local current = redis.call("INCR", KEYS[1])
    if tonumber(current) == 1 then
      redis.call("PEXPIRE", KEYS[1], ARGV[1])
    end
    return current
  `;

  constructor(config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) throw new Error('REDIS_URL is not configured');
    this.redis = new Redis(redisUrl);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const storageKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle-block:${throttlerName}:${key}`;

    const blockedTtl = await this.redis.pttl(blockKey);
    if (blockedTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedTtl / 1000),
      };
    }

    const totalHits = (await this.redis.eval(
      this.incrementScript,
      1,
      storageKey,
      ttl,
    )) as number;
    const pttl = await this.redis.pttl(storageKey);
    const timeToExpire = Math.ceil(Math.max(pttl, 0) / 1000);

    if (totalHits > limit && blockDuration > 0) {
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
      return {
        totalHits,
        timeToExpire,
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire,
      isBlocked: totalHits > limit,
      timeToBlockExpire: 0,
    };
  }
}
