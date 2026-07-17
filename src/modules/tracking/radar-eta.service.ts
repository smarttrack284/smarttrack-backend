import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RadarRateLimiter } from './radar-rate-limiter.service';
import type { GeoPoint } from '#/common/utils/geo-distance.util';

export type EtaResult = { minutes: number; source: 'radar' } | { minutes: null; source: 'unavailable' };

const CACHE_TTL_SECONDS = 20;
const REQUEST_TIMEOUT_MS = 4000;

/**
 * The ONLY source of truth for ETA in this app — a real routed duration
 * from Radar's Directions API, never a straight-line guess. If Radar is
 * unreachable, rate-limited, or returns no route, this returns
 * { minutes: null, source: 'unavailable' } rather than fabricating a
 * number — TrackingService falls back to the last KNOWN real ETA when
 * that happens, and is explicit in the payload about which case occurred,
 * rather than silently degrading to an estimate the frontend can't tell
 * apart from a real one.
 */
@Injectable()
export class RadarEtaService {
  private readonly logger = new Logger(RadarEtaService.name);
  private readonly redis: Redis;
  private readonly secretKey?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly rateLimiter: RadarRateLimiter,
  ) {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) throw new Error('REDIS_URL is not configured');
    this.redis = new Redis(redisUrl);
    // Server-side calls use the SECRET key, not the frontend's publishable
    // key — higher rate-limit tier, and never exposed to a browser.
    this.secretKey = this.config.get<string>('RADAR_SECRET_KEY');
  }

  async getEtaMinutes(from: GeoPoint, to: GeoPoint): Promise<EtaResult> {
    const cacheKey = this.buildCacheKey(from, to);

    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      return { minutes: Number(cached), source: 'radar' };
    }

    if (!this.secretKey) {
      this.logger.warn('RADAR_SECRET_KEY is not configured — ETA unavailable');
      return { minutes: null, source: 'unavailable' };
    }

    const allowed = await this.rateLimiter.tryAcquire();
    if (!allowed) {
      this.logger.warn('Radar rate limit reached — skipping this ETA calculation');
      return { minutes: null, source: 'unavailable' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const locations = `${from.lat},${from.lng}|${to.lat},${to.lng}`;
      const url = `https://api.radar.io/v1/route/directions?locations=${encodeURIComponent(locations)}&mode=car`;

      const res = await fetch(url, {
        headers: { Authorization: this.secretKey },
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(`Radar directions request failed (${res.status})`);
        return { minutes: null, source: 'unavailable' };
      }

      const data = await res.json();
      const durationMinutes = data?.routes?.[0]?.duration?.value;

      if (typeof durationMinutes !== 'number') {
        return { minutes: null, source: 'unavailable' };
      }

      const minutes = Math.max(1, Math.round(durationMinutes));
      await this.redis.set(cacheKey, minutes, 'EX', CACHE_TTL_SECONDS);
      return { minutes, source: 'radar' };
    } catch (err) {
      this.logger.warn(`Radar directions request errored: ${err instanceof Error ? err.message : err}`);
      return { minutes: null, source: 'unavailable' };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Rounds the driver's position to ~11m precision so small GPS jitter reuses the same cache entry, while the target (a fixed pickup/dropoff) stays exact. */
  private buildCacheKey(from: GeoPoint, to: GeoPoint): string {
    const round = (n: number) => n.toFixed(4);
    return `radar-eta:${round(from.lat)},${round(from.lng)}:${to.lat},${to.lng}`;
  }
}