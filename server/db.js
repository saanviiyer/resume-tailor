// Per-user persistence + usage tracking, backed by Supabase Postgres via the
// service-role client. All functions take an explicit user_id (resolved from a
// verified JWT by the caller) and scope every query to it. No-ops / empty
// results when Supabase is not configured.
import { supabaseAdmin, supabaseEnabled } from "./supabase.js";
import { startOfUtcDay } from "./rateLimit.js";

// Ensure a profile row exists for the user (idempotent upsert). Safe to call on
// every authenticated request; cheap and keeps a stable place for plan/billing.
export async function ensureProfile(user) {
  if (!supabaseEnabled) return;
  await supabaseAdmin
    .from("profiles")
    .upsert(
      { user_id: user.id, email: user.email ?? null, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
}

// How many generations the user has run since 00:00 UTC today.
export async function countGenerationsToday(userId) {
  if (!supabaseEnabled) return 0;
  const since = startOfUtcDay().toISOString();
  const { count, error } = await supabaseAdmin
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "generation")
    .gte("created_at", since);
  if (error) throw new Error(`usage count failed: ${error.message}`);
  return count ?? 0;
}

// Record one generation against the daily cap.
export async function recordGeneration(userId) {
  if (!supabaseEnabled) return;
  const { error } = await supabaseAdmin
    .from("usage_events")
    .insert({ user_id: userId, kind: "generation" });
  if (error) throw new Error(`usage insert failed: ${error.message}`);
}

// Persist a completed application (job posting + generated result).
export async function saveApplication(userId, payload) {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabaseAdmin
    .from("applications")
    .insert({
      user_id: userId,
      resume_id: payload.resumeId ?? null,
      job_title: payload.jobTitle ?? null,
      job_url: payload.jobUrl ?? null,
      job_posting: payload.jobPosting,
      resume_snapshot: payload.resumeSnapshot ?? null,
      result: payload.result,
      mock_mode: Boolean(payload.mockMode),
    })
    .select("id, created_at")
    .single();
  if (error) throw new Error(`application insert failed: ${error.message}`);
  return data;
}

// List a user's recent applications (history panel).
export async function listApplications(userId, limit = 20) {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabaseAdmin
    .from("applications")
    .select("id, job_title, job_url, result, mock_mode, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`application list failed: ${error.message}`);
  return data ?? [];
}

// Save (or create) a base resume.
export async function saveResume(userId, { title, content }) {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabaseAdmin
    .from("resumes")
    .insert({ user_id: userId, title: title || "Untitled resume", content })
    .select("id, title, created_at")
    .single();
  if (error) throw new Error(`resume insert failed: ${error.message}`);
  return data;
}

// List a user's saved resumes.
export async function listResumes(userId, limit = 20) {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabaseAdmin
    .from("resumes")
    .select("id, title, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`resume list failed: ${error.message}`);
  return data ?? [];
}
