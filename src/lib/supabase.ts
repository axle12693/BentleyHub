import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anon);

let client: SupabaseClient | null = null;

/** Browser Supabase client (anon key only — all access is gated by row-level security). */
export function supabase(): SupabaseClient {
  if (!client) {
    if (!url || !anon) throw new Error('Supabase is not configured');
    client = createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}
