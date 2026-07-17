import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Separate from RedisThrottlerStorage (which protects YOUR API from
 * clients) — this protects RADAR's API from you. Radar's Directions
 * endpoint defaults to 10 req/s per their docs; this caps outbound calls
 * below that ceiling cluster-wide, atomically via Lua, so concurrent
 * drivers across multiple server instances can't collectively burst past
 * Radar's limit even though no single instance would.
 */
@Injectable()
export class RadarRateLimiter {
  private readonly redis: Redis;
  private readonly limitPerSecond: number;

  private readonly script = `
    local current = redis.call("INCR", KEYS[1])
    if tonumber(current) == 1 then
      redis.call("PEXPIRE", KEYS[1], 1000)
    end
    return current
  `;

  constructor(config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) throw new Error('REDIS_URL is not configured');
    this.redis = new Redis(redisUrl);
    this.limitPerSecond = Number(config.get<string>('RADAR_RATE_LIMIT_PER_SECOND') ?? 8);
  }

  /** Returns true if this call is allowed to proceed right now. Never queues/waits — a denied call should fall back immediately, not block the caller. */
  async tryAcquire(): Promise<boolean> {
    const key = `radar-rl:${Math.floor(Date.now() / 1000)}`;
    const count = (await this.redis.eval(this.script, 1, key)) as number;
    return count <= this.limitPerSecond;
  }
}