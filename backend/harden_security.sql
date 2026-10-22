-- ============================================================
-- RagaStream: lock the database down before deploying
-- ============================================================
-- Run once in Supabase Dashboard → SQL Editor → New query. Safe to re-run.
-- Run recs_schema.sql and access_schema.sql first: this script also covers their
-- tables (listening_events, song_feedback, related_songs, user_access) and fails if they're missing.
--
-- Why this is safe: the app never reads or writes tables directly. Every
-- request goes through the FastAPI backend, which uses the service_role key
-- (that key ignores grants and RLS). The phone only uses Supabase for sign-in.
-- So the public roles (`anon` = anyone with the app's key, `authenticated` =
-- any signed-in user) need no table access at all.
--
-- What it does:
--   1. Removes all direct table access for anon and authenticated.
--   2. Rewrites the RLS policies so that, if access is ever granted again by
--      mistake, they still only expose a user's own rows, and the shared
--      `songs` catalogue and the `related_songs` graph are read-only (before: any signed-in user could edit
--      or delete any song, which cascades into everyone's playlists).
--   3. Stops new tables in `public` from being auto-granted to those roles.
-- ============================================================

begin;

-- 1. No direct table access for the public roles -------------------------------
revoke all on table
  public.songs, public.playlists, public.playlist_songs, public.liked_songs, public.play_history,
  public.listening_events, public.song_feedback, public.related_songs, public.user_access
from anon, authenticated;

-- The backend keeps full access (same as fix_permissions.sql).
grant all on table
  public.songs, public.playlists, public.playlist_songs, public.liked_songs, public.play_history,
  public.listening_events, public.song_feedback, public.related_songs, public.user_access
to service_role;

-- 2. RLS stays on, with policies as a second line of defence --------------------
alter table public.songs          enable row level security;
alter table public.playlists      enable row level security;
alter table public.playlist_songs enable row level security;
alter table public.liked_songs    enable row level security;
alter table public.play_history   enable row level security;
alter table public.listening_events enable row level security;
alter table public.song_feedback    enable row level security;
alter table public.related_songs    enable row level security;
alter table public.user_access      enable row level security;

-- Start clean: drop every existing policy on these tables, whatever it's called
-- (policies made in the dashboard don't use the README's names, e.g. an old
-- "Authenticated insert/update" on songs). Only the policies below remain.
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('songs', 'playlists', 'playlist_songs', 'liked_songs', 'play_history',
                       'listening_events', 'song_feedback', 'related_songs', 'user_access')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- songs: shared catalogue. Signed-in users may read it; only the backend writes.
create policy "Signed-in read" on public.songs
  for select to authenticated using (true);

-- Per-user tables: your own rows only. `(select auth.uid())` is evaluated once
-- per query instead of once per row (Supabase's recommended form).
create policy "Own playlists" on public.playlists
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Own playlist songs" on public.playlist_songs
  for all to authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = (select auth.uid())));

create policy "Own likes" on public.liked_songs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Own history" on public.play_history
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Recommendation engine: events and feedback are per user; the Mix graph is shared.
create policy "Own events" on public.listening_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Own feedback" on public.song_feedback
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Signed-in read" on public.related_songs
  for select to authenticated using (true);

-- Approval status: a user may read only their own row; only the backend writes it.
create policy "Own access" on public.user_access
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 3. New tables don't get auto-granted to the public roles ----------------------
-- (Supabase grants new `public` tables to anon/authenticated by default.)
-- If you add a table later, enable RLS on it too; the backend will still work.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- 4. Supabase's "auto-enable RLS" event-trigger function is callable over /rest/v1/rpc by default.
-- Nobody needs to call it; the event trigger keeps firing without EXECUTE.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

commit;

-- ============================================================
-- Check: both queries below should match the "expect" notes.
-- ============================================================

-- Expect: no rows (the public roles have no table access).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- Expect: RLS on for all nine tables, exactly 1 policy each.
select c.relname as table, c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by 1;
