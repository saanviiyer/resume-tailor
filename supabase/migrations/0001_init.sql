-- Resume Tailor — initial schema
-- Tables: profiles, resumes, applications, usage_events
-- Every row is keyed by user_id -> auth.users, RLS enabled, with
-- `auth.uid() = user_id` policies so a signed-in user can only ever see and
-- mutate their own rows. The server uses the SERVICE ROLE key, which bypasses
-- RLS; these policies protect against any direct (anon/authenticated) access.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user (display metadata, future plan/billing hook)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text,
  -- Billing hook for later (see README "where Stripe would plug in"): a plan
  -- column lets you raise limits per user without a schema change.
  plan        text not null default 'free',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- resumes: the user's saved base resumes
-- ---------------------------------------------------------------------------
create table if not exists public.resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Untitled resume',
  content     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists resumes_user_id_created_at_idx
  on public.resumes (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- applications: a job posting + the generated review / tailored resume / answers
-- ---------------------------------------------------------------------------
create table if not exists public.applications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  resume_id    uuid references public.resumes (id) on delete set null,
  job_title    text,
  job_url      text,
  job_posting  text not null,
  resume_snapshot text,               -- resume text used for this generation
  result       jsonb not null,        -- { review, tailoredResume, supplementalAnswers }
  mock_mode    boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists applications_user_id_created_at_idx
  on public.applications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- usage_events: one row per AI generation, used to enforce the daily cap
-- ---------------------------------------------------------------------------
create table if not exists public.usage_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null default 'generation',
  created_at  timestamptz not null default now()
);

-- The rate-limit query counts rows for (user_id, created_at >= start-of-day).
create index if not exists usage_events_user_id_created_at_idx
  on public.usage_events (user_id, created_at desc);

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.profiles     enable row level security;
alter table public.resumes      enable row level security;
alter table public.applications enable row level security;
alter table public.usage_events enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- resumes -------------------------------------------------------------------
drop policy if exists "resumes_select_own" on public.resumes;
create policy "resumes_select_own" on public.resumes
  for select using (auth.uid() = user_id);

drop policy if exists "resumes_insert_own" on public.resumes;
create policy "resumes_insert_own" on public.resumes
  for insert with check (auth.uid() = user_id);

drop policy if exists "resumes_update_own" on public.resumes;
create policy "resumes_update_own" on public.resumes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "resumes_delete_own" on public.resumes;
create policy "resumes_delete_own" on public.resumes
  for delete using (auth.uid() = user_id);

-- applications --------------------------------------------------------------
drop policy if exists "applications_select_own" on public.applications;
create policy "applications_select_own" on public.applications
  for select using (auth.uid() = user_id);

drop policy if exists "applications_insert_own" on public.applications;
create policy "applications_insert_own" on public.applications
  for insert with check (auth.uid() = user_id);

drop policy if exists "applications_delete_own" on public.applications;
create policy "applications_delete_own" on public.applications
  for delete using (auth.uid() = user_id);

-- usage_events --------------------------------------------------------------
drop policy if exists "usage_events_select_own" on public.usage_events;
create policy "usage_events_select_own" on public.usage_events
  for select using (auth.uid() = user_id);

drop policy if exists "usage_events_insert_own" on public.usage_events;
create policy "usage_events_insert_own" on public.usage_events
  for insert with check (auth.uid() = user_id);
