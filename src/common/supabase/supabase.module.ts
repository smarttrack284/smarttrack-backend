import { Global, Module } from '@nestjs/common';

import { SupabaseAdminProvider } from './supabase.provider';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
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
  ],
  providers: [SupabaseAdminProvider],
  exports: [SupabaseAdminProvider],
})
export class SupabaseModule {}
