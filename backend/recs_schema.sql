-- ============================================================
-- RagaStream: tables for the recommendation engine
-- ============================================================
-- Run once in Supabase Dashboard → SQL Editor → New query. Safe to re-run.
-- Then run harden_security.sql again: it covers these three tables too
-- (no access for anon / authenticated, own-rows policies as a second line).
--
-- listening_events  per-user, append-only log of starts, skips, likes…
--                   (the backend keeps the newest 5,000 rows per user)
-- song_feedback     per-user explicit "hide" for a song or a channel
-- related_songs     shared graph built from YouTube Mixes (7-day freshness)
--
-- See docs/RECOMMENDATIONS.md for what each column means.
-- ============================================================

begin;

create table if not exists public.listening_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  youtube_id   text not null,
  song_id      uuid null references public.songs (id) on delete set null,
  event        text not null
               check (event in ('start', 'skip', 'complete', 'like', 'unlike', 'save', 'queue', 'hide')),
  surface      text not null default 'other'
               check (surface in ('autoplay', 'radio', 'smart_shuffle', 'home', 'playlist_recs',
                                  'search', 'library', 'playlist', 'liked', 'channel', 'queue', 'other')),
  context_id   text null,
  rec_id       text null,
  listened_sec real null,
  duration_sec real null,
  local_hour   smallint null check (local_hour between 0 and 23),
  features     jsonb null,
  created_at   timestamptz not null default now()
);

create index if not exists listening_events_user_created_idx
  on public.listening_events (user_id, created_at desc);
create index if not exists listening_events_user_youtube_idx
  on public.listening_events (user_id, youtube_id);

create table if not exists public.song_feedback (
  user_id     uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('song', 'channel')),
  target_id   text not null,
  kind        text not null check (kind in ('hide')),
  label       text null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table if not exists public.related_songs (
  seed_id     text not null,
  youtube_id  text not null,
  rank        smallint not null,
  title       text not null,
  channel     text not null,
  duration    integer not null default 0,
  fetched_at  timestamptz not null default now(),
  primary key (seed_id, youtube_id)
);

create index if not exists related_songs_youtube_idx
  on public.related_songs (youtube_id);

alter table public.listening_events enable row level security;
alter table public.song_feedback    enable row level security;
alter table public.related_songs    enable row level security;

-- The backend (service_role) reads and writes these; the public roles get nothing.
-- harden_security.sql revokes new-table grants by default, so grant explicitly.
grant all on table public.listening_events, public.song_feedback, public.related_songs to service_role;
revoke all on table public.listening_events, public.song_feedback, public.related_songs from anon, authenticated;

commit;
