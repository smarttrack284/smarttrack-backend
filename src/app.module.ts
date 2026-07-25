import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CompaniesModule } from "#/modules/companies/companies.module";
import { UsersModule } from "#/modules/users/users.module";
import { SupabaseModule } from "#/common/supabase/supabase.module";
import { OrdersModule } from "#/modules/orders/orders.module";
import { DispatchModule } from "#/modules/dispatch/dispatch.module";
import { TeamModule } from "#/modules/team/team.module";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AuthCoreModule } from "#/common/auth/auth-core.module";
import { TrackingModule } from "#/modules/tracking/tracking.module";
import { APP_GUARD } from "@nestjs/core";
import { RateLimitModule } from "#/common/rate-limit/rate-limit.module";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { OverviewModule } from "#/modules/overview/overview.module";
import { AnalyticsModule } from "#/modules/analytics/analytics.module";
import { CacheModule } from "#/common/cache/cache.module";
import { StorageModule } from "#/common/storage/storage.module";
import { BillingModule } from "#/modules/billing/billing.module";
import { MailModule } from "#/modules/mail/mail.module";
import { BullModule } from "@nestjs/bullmq";
import { ErrorHandlerModule } from "#/common/errors/error-handler.module";
import { ApiKeyAuthModule } from "#/common/api-key-auth/api-key-auth.module";
import { NotificationsModule } from "#/modules/notifications/notifications.module";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ".env"
        }),
        BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                connection: {
                    url: config.get<string>("REDIS_URL")
                }
            })
        }),
        ApiKeyAuthModule,
        NotificationsModule,
        ErrorHandlerModule,
        EventEmitterModule.forRoot(),
        StorageModule,
        MailModule,
        CacheModule,
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
        AnalyticsModule,
        BillingModule
    ],

    controllers: [AppController],
    providers: [
        AppService,
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard
        }
    ]
})
export class AppModule {}
