import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client, using the SERVICE ROLE key — not the
 * publishable/anon key the frontend uses. This key bypasses Row Level
 * Security entirely, which is exactly why it must:
 *   - never be sent to or exposed in any client-facing response
 *   - never be logged
 *   - only ever live in this one module, injected via DI, not
 *     re-instantiated ad hoc elsewhere in the codebase
 *
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to create the Supabase admin client',
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // This client is used for server-to-server admin operations only —
      // it should never try to persist or auto-refresh a browser session.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
