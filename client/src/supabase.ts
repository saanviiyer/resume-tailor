import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Client-side Supabase, created only when both public env vars are present.
// When unset the app runs in ANONYMOUS mode: no auth, no persistence, no limits
// (mirrors the server's anonymous fallback). The anon key is a public key and
// is safe to expose in the browser; the service-role key is never here.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url as string, anonKey as string)
  : null;
