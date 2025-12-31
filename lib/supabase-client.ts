// Server-side Supabase client factory
import { createClient } from '@supabase/supabase-js'

// Use service role key for server-side operations (bypasses RLS)
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function createServerClient() {
  if (!url || !serviceKey) throw new Error('Missing Supabase env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

// Browser-side Supabase client for realtime only (uses anon key if available, otherwise null)
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseBrowser = url && anonKey
  ? createClient(url, anonKey, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 2 } },
  })
  : null

// Export a server-side supabase instance using service role key
export const supabaseServer = url && serviceKey
  ? createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
  : null
