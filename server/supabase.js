// Server-side Supabase integration: a SERVICE ROLE client used to (a) validate
// the caller's Supabase JWT and (b) read/write per-user data. The service role
// key bypasses RLS, so this module must only ever run on the server — the key
// is never sent to the browser.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// When either is unset the app runs in ANONYMOUS mode: no auth, no persistence,
// no limits (see README + server/index.js). This mirrors the mock-AI fallback.
export const supabaseEnabled = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

export const supabaseAdmin = supabaseEnabled
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Pull the bearer token out of an Authorization header.
export function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Validate the JWT with Supabase and return the user, or null if invalid.
// Uses the service-role client's auth.getUser(token), which verifies the token
// against the project and returns the authenticated user.
export async function getUserFromToken(token) {
  if (!supabaseEnabled || !token) return null;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

// Convenience: resolve the user directly from a request's Authorization header.
export async function getUserFromRequest(req) {
  return getUserFromToken(extractBearerToken(req));
}
