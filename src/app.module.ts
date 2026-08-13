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
import { AuthCoreModule } from "#/common/auth/auth-core.module";
import { TrackingModule } from "#/modules/tracking/tracking.module";
import { APP_FILTER } from "@nestjs/core";
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
import { ScheduleModule } from "@nestjs/schedule";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { ApiKeysModule } from "#/modules/api-keys/api-keys.module";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { AuthModule } from "./modules/auth/auth.module";
import { LoggerModule } from "nestjs-pino";
import { AdminModule } from "./modules/admin/admin.module";
@Module({
    imports: [
        SentryModule.forRoot(),
        LoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                pinoHttp: {
                    level:
                        config.get<string>("NODE_ENV") === "production"
                            ? "info"
                            : "debug",
                    // In production, output JSON. In development, use pretty printing.
                    transport:
                        config.get<string>("NODE_ENV") !== "production"
                            ? {
                                  target: "pino-pretty",
                                  options: { colorize: true }
                              }
                            : undefined,
                    // Do not log bodies (security) – can be overridden per route if needed
                    serializers: {
                        req(req) {
                            return { method: req.method, url: req.url };
                        },
                        res(res) {
                            return { statusCode: res.statusCode };
                        }
                    },
                    // Optionally add request‑id to every log line
                    genReqId: req => req.id
                }
            })
        }),
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
        ScheduleModule.forRoot(),
        AuthModule,
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
        BillingModule,
        WebhooksModule,
        ApiKeysModule,
        AdminModule
    ],

    controllers: [AppController],
    providers: [
        AppService,
        {
            provide: APP_FILTER,
            useClass: SentryGlobalFilter
        }
    ]
})
export class AppModule {}
