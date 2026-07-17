import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler-storage.service';

/**
 * @Global + registered once in AppModule. Sets the app-wide default limit
 * (overridable per-route with @Throttle, exactly as TrackingController
 * already does) and swaps in Redis storage so the limit is enforced
 * consistently across however many server instances are running.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: new RedisThrottlerStorage(config),
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
