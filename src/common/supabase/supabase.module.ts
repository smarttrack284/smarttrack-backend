import { Global, Module } from '@nestjs/common';

import { SupabaseAdminProvider } from './supabase.provider';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';

@Global()
@Module({
  providers: [SupabaseAdminProvider, SupabaseAuthGuard],
  exports: [SupabaseAdminProvider, SupabaseAuthGuard],
})
export class SupabaseModule {}
