import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CompaniesModule } from "#/modules/companies/companies.module";
import { UsersModule } from "#/modules/users/users.module";
import { SupabaseModule } from "#/common/supabase/supabase.module";
import { OrdersModule } from "#/modules/orders/orders.module";
import { DispatchModule } from "#/modules/dispatch/dispatch.module";
import { TeamModule } from "#/modules/team/team.module";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ".env"
        }),
        SupabaseModule,
        CompaniesModule,
        UsersModule,
        OrdersModule,
        DispatchModule,
        TeamModule
    ],

    controllers: [AppController],
    providers: [AppService]
})
export class AppModule {}
