import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { publicEnv, serverEnv } from '@/lib/env';

let admin: ReturnType<typeof createClient<Database>> | undefined;

// Service-role client: bypasses RLS. Only use it after checking who the caller is and what they may do.
export function supabaseAdmin() {
  if (!serverEnv.supabaseSecretKey) throw new Error('SUPABASE_SECRET_KEY is not set.');
  admin ??= createClient<Database>(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
