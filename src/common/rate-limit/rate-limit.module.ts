import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler-storage.service';

@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          // Default limiter (applied when no @Throttle() decorator is used)
          { ttl: 60_000, limit: 100 },
          // Named limiter for external API endpoints
          { name: 'api', ttl: 60_000, limit: 100 },
        ],
        storage: new RedisThrottlerStorage(config),
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}