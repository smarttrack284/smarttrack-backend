import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from '#/common/supabase/supabase.module';
import { StorageService } from './storage.service';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
