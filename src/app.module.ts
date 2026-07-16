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
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthCoreModule } from '#/common/auth/auth-core.module';
import { TrackingModule } from '#/modules/tracking/tracking.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    SupabaseModule,
    AuthCoreModule,
    CompaniesModule,
    UsersModule,
    OrdersModule,
    DispatchModule,
    TeamModule,
    TrackingModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
