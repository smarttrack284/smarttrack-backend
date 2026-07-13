import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompaniesModule } from '#/modules/companies/companies.module';
import { UsersModule } from '#/modules/users/users.module';

@Module({
  imports: [
    // Config module setup for env variables
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Database setup
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('SUPABASE_DATABASE_URL'),
        password: config.get<string>('SUPABASE_DB_PASSWORD'),
        autoLoadEntities: true,
        logging: config.get<string>('NODE_ENV') === 'production',
        synchronize: config.get<string>('NODE_ENV') === 'production',
      }),
      inject: [ConfigService],
    }),

    CompaniesModule,
    UsersModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
