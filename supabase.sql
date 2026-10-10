-- ==============================================================================
-- FLUXFOX DAY 1 SKELETON: DATABASE & AUTHENTICATION SCHEMA
-- Target Engine: Supabase (PostgreSQL 15+)
-- Description: Creates the public.users table for storing user accounts,
--              metadata, and Google OAuth offline refresh tokens for calendar writes.
-- ==============================================================================

-- 1. Create the public.users table
create table if not exists public.users (
  id uuid references auth.users(id) on delete cascade not null primary key,
  email text not null,
  full_name text,
  avatar_url text,
  google_refresh_token text,
  vapi_assistant_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 1b. Day 3: add the Vapi assistant id column for existing deployments
-- (safe/idempotent for databases that already ran the Day 1 migration above)
alter table public.users
  add column if not exists vapi_assistant_id text;

-- 1c. Day 8: add the Stripe subscription paywall columns
-- (safe/idempotent for databases that already ran earlier migrations above)
alter table public.users
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_status text default 'inactive';

-- 1d. Day 14: add the Apple IAP paywall columns
-- (safe/idempotent for databases that already ran earlier migrations above)
alter table public.users
  add column if not exists apple_original_transaction_id text,
  add column if not exists apple_product_id text;

-- 2. Performance indexes
create index if not exists users_email_idx on public.users (email);
create index if not exists users_created_at_idx on public.users (created_at desc);

-- 3. Enable Row Level Security (RLS)
alter table public.users enable row level security;

-- 4. RLS Policies

-- Policy A: Allow authenticated users to view their own profile data
create policy "Users can view their own profile"
  on public.users
  for select
  using (auth.uid() = id);

-- Policy B: Allow authenticated users to update their own profile data
create policy "Users can update their own profile"
  on public.users
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Policy C: Allow users (or auth callback) to insert their initial profile row
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

-- Comment documentation on columns
comment on table public.users is 'FluxFox core user directory and OAuth token vault';
comment on column public.users.google_refresh_token is 'Offline access refresh token required to write to https://www.googleapis.com/auth/calendar.events';
comment on column public.users.vapi_assistant_id is 'The Vapi.ai assistant id deployed for this user''s AI receptionist (see /api/assistant/deploy).';
comment on column public.users.stripe_customer_id is 'The Stripe Customer id created for this user (see /api/stripe/checkout and /api/stripe/webhook).';
comment on column public.users.subscription_status is 'The FluxFox subscription state for this user: ''inactive'' | ''active'' (set to ''active'' by /api/stripe/webhook on checkout.session.completed, or by /api/apple/verify-receipt on a verified Apple IAP subscription).';
comment on column public.users.apple_original_transaction_id is 'The App Store original_transaction_id for this user''s active auto-renewable subscription (see /api/apple/verify-receipt).';
comment on column public.users.apple_product_id is 'The App Store Connect product id (SKU) for this user''s active subscription plan (see /api/apple/verify-receipt).';

-- ==============================================================================
-- FLUXFOX DAY 10: CALL TELEMETRY LOGGING
-- Description: Creates public.call_logs to capture every inbound Vapi
--              tool-call webhook event (successful bookings and the Day 9
--              hallucination fallback) for live-fire test diagnostics.
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
