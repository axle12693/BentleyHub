import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

/** Browser Supabase client (publishable key only — all access is gated by grants + row-level security). */
export function supabase(): SupabaseClient {
  if (!client) {
    if (!url || !key) throw new Error('Supabase is not configured');
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}
