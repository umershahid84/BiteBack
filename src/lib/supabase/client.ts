'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { publicEnv } from '@/lib/env';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

// One Supabase client per browser tab. Queries run as the signed-in user, so RLS applies.
export function supabaseBrowser() {
  client ??= createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey);
  return client;
}
