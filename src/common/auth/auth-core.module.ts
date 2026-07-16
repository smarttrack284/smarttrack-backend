import { Global, Module } from '@nestjs/common';
import { SupabaseJwtVerifierService } from './supabase-jwt-verifier.service';

/**
 * @Global so SupabaseJwtVerifierService is resolvable from any module's
 * guards without every module needing to explicitly import this one —
 * same reasoning as ConfigModule being global. Import this once in
 * AppModule.
 */
@Global()
@Module({
  providers: [SupabaseJwtVerifierService],
  exports: [SupabaseJwtVerifierService],
})
export class AuthCoreModule {}
