import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler-storage.service';
import { UserAwareThrottlerGuard } from '#/common/guards/use-aware-throttler.guard';

@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          // Default: authenticated dashboard usage
          { name: 'default', ttl: 60_000, limit: 60 },

          // Auth: login, signup, forgot-password, verify, resend
          { name: 'auth', ttl: 60_000, limit: 5 },

          // Public: unauthenticated landing pages, health checks
          { name: 'public', ttl: 60_000, limit: 30 },

          // Uploads: POD photos, avatars, logos
          { name: 'upload', ttl: 60_000, limit: 10 },

          // Webhooks: must be loose (Paystack uses shared IPs)
          { name: 'webhook', ttl: 60_000, limit: 1_000 },

          // API
          { name: 'api', ttl: 60_000, limit: 60 },
        ],
        storage: new RedisThrottlerStorage(config),
      }),
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: UserAwareThrottlerGuard,
    },
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
