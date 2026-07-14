import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CompaniesModule } from "#/modules/companies/companies.module";
import { UsersModule } from "#/modules/users/users.module";
import { SupabaseModule } from "#/common/supabase/supabase.module";
import { OrdersModule } from "#/modules/orders/orders.module";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ".env"
        }),
        SupabaseModule,
        TypeOrmModule.forRootAsync({
            useFactory: (config: ConfigService) => ({
                type: "postgres",
                url: config.get<string>("SUPABASE_DATABASE_URL"),
                password: config.get<string>("SUPABASE_DB_PASSWORD"),
                autoLoadEntities: true,
                logging: config.get<string>("NODE_ENV") === "production",
                synchronize: config.get<string>("NODE_ENV") === "production"
            }),
            inject: [ConfigService]
        }),

        CompaniesModule,
        UsersModule,
        OrdersModule
    ],

    controllers: [AppController],
    providers: [AppService]
})
export class AppModule {}
