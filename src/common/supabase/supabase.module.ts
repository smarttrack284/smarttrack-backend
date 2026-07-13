import { Module } from '@nestjs/common';
import { createSupabaseAdminClient } from '#/config/supabase.config';

export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');

@Module({
  providers: [
    {
      provide: SUPABASE_CLIENT,
      useFactory: () => createSupabaseAdminClient(),
    },
  ],
  exports: [SUPABASE_CLIENT],
})
export class SupabaseModule {}
