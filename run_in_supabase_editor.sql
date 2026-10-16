-- ==============================================================================
-- FLUXFOX — EMERGENCY SCHEMA REPAIR (run this entire file in the Supabase
-- SQL Editor against project ref `cwqhecpuvhijgnphmqyh`)
--
-- WHY THIS FILE EXISTS:
--   Production is returning PGRST205 ("Could not find the table ... in the
--   schema cache") on /dashboard and /api/assistant/deploy because
--   public.users and public.call_logs do not exist on the live database —
--   the migration in `supabase.sql` (this repo's authoritative source of
--   truth, assembled from the Day 1 / Day 3 / Day 4 / Day 8 / Day 10 /
--   Day 14 comments throughout src/app/api/**) was apparently never run
--   against this project.
--
--   This file is a single, idempotent, self-contained reproduction of that
--   schema (safe to re-run any number of times — every statement uses
--   `if not exists` / `or replace` / `drop ... if exists` guards) plus the
--   PostgREST cache-reload NOTIFY, so it can be pasted directly into the
--   Supabase Dashboard's SQL Editor with no CLI link required.
--
--   Columns required by src/app/dashboard/page.tsx and every route handler
--   under src/app/api/ are all included below:
--     public.users:
--       id, email, full_name, avatar_url, google_refresh_token,
--       vapi_assistant_id, twilio_phone_number, stripe_customer_id,
--       subscription_status, apple_original_transaction_id,
--       apple_product_id, created_at
--     public.call_logs:
--       id, assistant_id, customer_phone, raw_payload, created_at
-- ==============================================================================

-- 0. Required extension for gen_random_uuid() (enabled by default on
-- Supabase, but declared here so this file is portable/self-contained).
create extension if not exists pgcrypto;

-- ==============================================================================
-- PART 1: public.users
-- ==============================================================================

-- 1. Create the public.users table (see src/app/dashboard/page.tsx,
-- src/app/auth/callback/route.ts, src/app/api/assistant/deploy/route.ts,
-- src/app/api/phone/provision/route.ts, src/app/api/stripe/checkout+webhook,
-- src/app/api/apple/verify-receipt/route.ts, src/app/api/webhook/vapi/route.ts,
-- src/lib/google.ts)
create table if not exists public.users (
  id uuid references auth.users(id) on delete cascade not null primary key,
  email text not null,
  full_name text,
  avatar_url text,
  google_refresh_token text,
  vapi_assistant_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 1b. Day 3: Vapi assistant id column (idempotent for partially-migrated DBs)
alter table public.users
  add column if not exists vapi_assistant_id text;

-- 1c. Day 4: Twilio business line column — read/written by
-- src/app/api/phone/provision/route.ts and rendered by
-- src/app/dashboard/page.tsx / src/components/dashboard/FluxFoxConsole.tsx.
-- (This column was missing from the previous migration file and is a
-- required part of the authoritative schema.)
alter table public.users
  add column if not exists twilio_phone_number text;

-- 1d. Day 8: Stripe subscription paywall columns
alter table public.users
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_status text default 'inactive';

-- 1e. Day 14: Apple IAP paywall columns
alter table public.users
  add column if not exists apple_original_transaction_id text,
  add column if not exists apple_product_id text;

-- 1f. Phase 2: editable business profile + VA system prompt
-- (see /api/assistant/settings and the dashboard's #ai-settings panel)
alter table public.users
  add column if not exists business_name text,
  add column if not exists business_industry text,
  add column if not exists business_address text,
  add column if not exists vapi_system_prompt text;

notify pgrst, 'reload schema';

-- 2. Performance indexes
create index if not exists users_email_idx on public.users (email);
create index if not exists users_created_at_idx on public.users (created_at desc);
create unique index if not exists users_vapi_assistant_id_idx
  on public.users (vapi_assistant_id)
  where vapi_assistant_id is not null;

-- 3. Enable Row Level Security (RLS)
alter table public.users enable row level security;

-- 4. RLS Policies (drop-and-recreate so this file is safely re-runnable)

-- Policy A: Allow authenticated users to view their own profile data
drop policy if exists "Users can view their own profile" on public.users;
create policy "Users can view their own profile"
  on public.users
  for select
  using (auth.uid() = id);

-- Policy B: Allow authenticated users to update their own profile data
drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Policy C: Allow users (or the auth callback) to insert their initial profile row
drop policy if exists "Users can insert their own profile" on public.users;
create policy "Users can insert their own profile"
  on public.users
  for insert
  with check (auth.uid() = id);

-- 5. Automated trigger function to provision user profile on auth.users signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, avatar_url, created_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', ''),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.users.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url);

  return new;
end;
$$;

-- 6. Attach trigger to auth.users table
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
-- 6b. Backfill: populate public.users from any pre-existing auth.users rows
-- (idempotent; safe to re-run)
insert into public.users (id, email, full_name, avatar_url)
select id, email, raw_user_meta_data->>'full_name', raw_user_meta_data->>'avatar_url'
from auth.users
on conflict (id) do nothing;



-- Comment documentation on columns
comment on table public.users is 'FluxFox core user directory and OAuth token vault';
comment on column public.users.google_refresh_token is 'Offline access refresh token required to write to https://www.googleapis.com/auth/calendar.events';
comment on column public.users.vapi_assistant_id is 'The Vapi.ai assistant id deployed for this user''s AI receptionist (see /api/assistant/deploy).';
comment on column public.users.twilio_phone_number is 'The purchased Twilio phone number bound to this user''s Vapi assistant (see /api/phone/provision).';
comment on column public.users.stripe_customer_id is 'The Stripe Customer id created for this user (see /api/stripe/checkout and /api/stripe/webhook).';
comment on column public.users.subscription_status is 'The FluxFox subscription state for this user: ''inactive'' | ''active'' (set to ''active'' by /api/stripe/webhook on checkout.session.completed, or by /api/apple/verify-receipt on a verified Apple IAP subscription).';
comment on column public.users.apple_original_transaction_id is 'The App Store original_transaction_id for this user''s active auto-renewable subscription (see /api/apple/verify-receipt).';
comment on column public.users.apple_product_id is 'The App Store Connect product id (SKU) for this user''s active subscription plan (see /api/apple/verify-receipt).';

-- ==============================================================================
-- PART 2: public.call_logs
-- Captures every inbound Vapi tool-call webhook event (see
-- src/app/api/webhook/vapi/route.ts) and is read back by
-- src/app/dashboard/page.tsx for the Recent Calls table.
-- ==============================================================================

-- 7. Create the public.call_logs table
create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  assistant_id text not null,
  customer_phone text,
  raw_payload jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 8. Performance indexes
create index if not exists call_logs_assistant_id_idx on public.call_logs (assistant_id);
create index if not exists call_logs_created_at_idx on public.call_logs (created_at desc);

-- 9. Enable Row Level Security (RLS)
alter table public.call_logs enable row level security;

-- 10. RLS Policy: only the Service Role (the Vapi webhook route, server-to-server,
-- no end-user session) may insert telemetry rows.
drop policy if exists "Service role can insert call logs" on public.call_logs;
create policy "Service role can insert call logs"
  on public.call_logs
  for insert
  to service_role
  with check (true);

-- 10b. RLS Policy: authenticated dashboard users may view only the call
-- logs belonging to their own deployed assistant (matched via
-- public.users.vapi_assistant_id, since call_logs has no direct user_id FK).
drop policy if exists "Users can view their own call logs" on public.call_logs;
create policy "Users can view their own call logs"
  on public.call_logs
  for select
  to authenticated
  using (
    assistant_id in (
      select vapi_assistant_id from public.users
      where id = auth.uid() and vapi_assistant_id is not null
    )
  );

comment on table public.call_logs is 'Telemetry log of every inbound Vapi tool-call webhook event (see /api/webhook/vapi), used for live-fire test diagnostics.';
comment on column public.call_logs.assistant_id is 'The Vapi assistant id (message.assistant.id / message.call.assistantId) that received the call.';
comment on column public.call_logs.customer_phone is 'The caller-provided customer_phone from the book_appointment tool call arguments, if available.';
comment on column public.call_logs.raw_payload is 'The entire raw Vapi webhook request body (JSON), stored verbatim for this tool-call event.';

-- ==============================================================================
-- PART 3: Schema usage + table grants
--
-- RLS policies above restrict *row* access, but PostgREST additionally
-- requires explicit SQL-level GRANTs on the schema and tables themselves
-- for each role it proxies (anon, authenticated, service_role) — this is
-- almost always the actual cause of a PGRST205 "Could not find the table
-- in the schema cache" error when the table *does* exist: the API roles
-- simply have no visibility into it.
-- ==============================================================================

-- 11. Schema usage
grant usage on schema public to anon, authenticated, service_role;

-- 12. public.users table grants
--   anon           — no direct access (all reads/writes happen post-auth)
--   authenticated  — select/update/insert, scoped further by RLS above
--   service_role   — full access, bypasses RLS (used by server-to-server
--                    webhooks: /api/webhook/vapi, /api/stripe/webhook,
--                    /api/apple/verify-receipt)
grant select, insert, update on public.users to authenticated;
grant select, insert, update, delete on public.users to service_role;

-- 13. public.call_logs table grants
--   authenticated  — select only, scoped further by RLS above
--   service_role   — full access, bypasses RLS (used by /api/webhook/vapi)
grant select on public.call_logs to authenticated;
grant select, insert, update, delete on public.call_logs to service_role;

-- 14. Default privileges so future columns/tables created by the postgres
-- role in this schema automatically carry the same grants (keeps this
-- migration forward-compatible with later `alter table` statements).
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- ==============================================================================
-- PART 4: Flush the PostgREST schema cache
-- Required after any DDL change so PostgREST immediately recognizes the
-- new/altered tables and columns instead of returning PGRST205 until its
-- next periodic cache refresh.
-- ==============================================================================
NOTIFY pgrst, 'reload schema';
