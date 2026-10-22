-- ============================================================
-- RagaStream: owner approves every new account
-- ============================================================
-- Run once in Supabase Dashboard -> SQL Editor -> New query. Safe to re-run.
-- Order: recs_schema.sql, then this file, then harden_security.sql (it covers
-- user_access too: no access for anon, own-row read for authenticated).
-- Deploy the Edge Functions in supabase/functions/ too (see its README), or
-- the owner never gets the sign-up email (sign-ups still work, and stay pending).
--
-- What it does:
--   1. public.user_access   one row per auth user: pending, approved or rejected.
--   2. A trigger on auth.users adds a `pending` row for every new sign-up and
--      calls the `notify-signup` Edge Function (via pg_net) to email the owner.
--      The call is best effort: a failed email never blocks a sign-up.
--   3. Seeds every existing user as `approved`, so today's accounts keep working.
--
-- The FastAPI backend (auth.py) reads user_access with the service-role key and
-- answers 403 to anyone who is not approved.
-- ============================================================

begin;

-- pg_net makes the async HTTP call (its functions live in schema `net`).
create extension if not exists pg_net;

-- Internal helpers live outside the API-exposed `public` schema.
create schema if not exists private;
revoke all on schema private from anon, authenticated, public;

create table if not exists public.user_access (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text,
  provider     text,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  notified_at  timestamptz
);

alter table public.user_access enable row level security;

drop policy if exists "Own access" on public.user_access;
create policy "Own access" on public.user_access
  for select to authenticated
  using ((select auth.uid()) = user_id);

grant all on table public.user_access to service_role;
revoke all on table public.user_access from anon, authenticated;

-- Runs inside the sign-up transaction, as the table owner.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_access (user_id, email, provider)
  values (new.id, new.email, new.raw_app_meta_data ->> 'provider')
  on conflict do nothing;

  -- Email the owner. Never let this fail a sign-up.
  begin
    perform net.http_post(
      url := 'https://jprsscsopqnwiihkgued.supabase.co/functions/v1/notify-signup',
      body := jsonb_build_object('user_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Everyone who already has an account keeps access.
insert into public.user_access (user_id, email, provider, status, decided_at)
select u.id, u.email, u.raw_app_meta_data ->> 'provider', 'approved', now()
from auth.users u
on conflict do nothing;

commit;

-- ============================================================
-- Check: expect the owner as `approved`, RLS on, one policy, trigger present.
-- ============================================================
select user_id, email, provider, status, decided_at from public.user_access order by requested_at;

select c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'user_access') as policies,
       (select count(*) from pg_trigger t where t.tgname = 'on_auth_user_created' and not t.tgisinternal) as trigger_present
from pg_class c
where c.oid = 'public.user_access'::regclass;
