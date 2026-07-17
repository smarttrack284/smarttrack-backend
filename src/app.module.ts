import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { CompaniesModule } from '#/modules/companies/companies.module';
import { UsersModule } from '#/modules/users/users.module';
import { SupabaseModule } from '#/common/supabase/supabase.module';
import { OrdersModule } from '#/modules/orders/orders.module';
import { DispatchModule } from '#/modules/dispatch/dispatch.module';
import { TeamModule } from '#/modules/team/team.module';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthCoreModule } from '#/common/auth/auth-core.module';
import { TrackingModule } from '#/modules/tracking/tracking.module';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitModule } from '#/common/rate-limit/rate-limit.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OverviewModule } from '#/modules/overview/overview.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule,
    RateLimitModule,
    SupabaseModule,
    AuthCoreModule,
    CompaniesModule,
    UsersModule,
    OrdersModule,
    DispatchModule,
    TeamModule,
    TrackingModule,
    OverviewModule,
  ],

  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
