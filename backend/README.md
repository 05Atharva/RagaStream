# RagaStream — Backend

FastAPI REST API that powers RagaStream. Handles YouTube search, audio stream URL extraction (via yt-dlp), Supabase auth, and all CRUD operations.

---

## Prerequisites

- Python 3.11 (check: `python --version`)
- A [Supabase](https://supabase.com) project with the tables created (see below)

---

## First-Time Setup

### 1. Create the virtual environment

```powershell
cd RagaStream/backend
python -m venv venv
```

> ⚠️ **Always use the `venv/` folder.** Do not create `.venv/` or any other env.

### 2. Activate the virtual environment

```powershell
# Windows (PowerShell)
venv\Scripts\activate

# You should see (venv) prefix in your terminal
```

### 3. Install dependencies

```powershell
pip install -r requirements.txt
```

### 4. Configure environment variables

```powershell
copy .env.example .env
# Then edit .env with your values:
```

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
# Optional
AUDIO_LINK_SECRET=long-random-string
CORS_ORIGINS=https://your-web-app.example
YTDLP_MAX_CONCURRENT=2
```

> Get these from your Supabase project:
> - **SUPABASE_URL** → Project Settings → API → Project URL
> - **SUPABASE_KEY** → Project Settings → API → `anon` / publishable key (used to verify sign-ins)
> - **SUPABASE_SERVICE_ROLE_KEY** → Project Settings → API → `service_role` secret key (database access; never ship it in the app)
> - **AUDIO_LINK_SECRET** (optional) → signs audio relay links. Defaults to a value derived from the service-role key. Set it explicitly in production so you can rotate it on its own.
> - **CORS_ORIGINS** (optional) → comma-separated browser origins allowed to call the API. The phone app doesn't need it; defaults to `*`.
> - **YTDLP_PROXY** (optional) → `http://`, `socks5://` or `socks5h://` proxy for everything sent to YouTube (yt-dlp and the audio relay), for hosts whose IP YouTube throttles. Use a sticky, residential proxy; see `docs/DEPLOY.md` 1e.
> - **YTDLP_MAX_CONCURRENT** (optional) → how many yt-dlp calls may run at once. Defaults to 2; raise it only on a host YouTube isn't throttling.

---

## Running the Backend (Every Time)

```powershell
cd RagaStream/backend

# Step 1 — Activate the venv
venv\Scripts\activate

# Step 2 — Start the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at:
- Local: `http://localhost:8000`
- LAN (for phone): `http://<your-wifi-ip>:8000`
- Swagger docs: `http://localhost:8000/docs`

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check (no sign-in) |
| GET | `/me/access` | Your approval status (`pending`, `approved`, `rejected`). Signed-in only; works before approval |
| GET | `/youtube/search?q=` | Search YouTube (cached 30 min) |
| GET | `/youtube/stream?id=` | Check a song is playable; returns a signed `audio_path` (extraction cached until shortly before YouTube's URL expiry, up to 4 h) |
| GET/HEAD | `/youtube/audio/{id}?exp=&sig=` | Audio relay with Range support. Needs the signed link from `/youtube/stream`, not a sign-in |
| GET | `/youtube/radio?id=` | Song radio (cached 1 h) |
| GET | `/lyrics`, `/artwork/color` | Synced lyrics, artwork palette (cached 24 h) |
| GET | `/songs` | List song catalogue |
| POST | `/songs` | Save song to catalogue |
| GET | `/genres` | List genres with count |
| GET `/POST /DELETE` | `/liked` | Liked songs |
| GET `/POST` | `/history` | Play history |
| GET `/POST /PUT /DELETE` | `/playlists` | Playlists CRUD |
| GET | `/search?q=` | Search catalogue |
| * | `/admin/*` | Admin-only operations |
| GET | `/recs/next`, `/recs/radio`, `/recs/home` | Recommendations: autoplay, radio, Home (see `docs/RECOMMENDATIONS.md`) |
| POST | `/recs/shuffle`, `/recs/playlist` | Smart Shuffle picks, playlist recommendations |
| POST | `/events` | Listening events (start, skip, complete, like, save, queue), batched |
| GET `/POST /DELETE` | `/feedback` | "Hide this song" / "Don't recommend this channel" |
| GET | `/recs/metrics` | Your skip, completion and save rates per surface (7 and 28 days) |
| POST | `/import/preview` | Read a public playlist link or a pasted song list; nothing is saved |
| POST | `/import/jobs` | Start an import: find each song on YouTube, then create the playlist. Returns `{job_id}` (202) |
| GET | `/import/jobs/{job_id}` | Import progress and per-song results (owner only, else 404) |
| POST | `/import/jobs/{job_id}/cancel` | Stop an import (204) |

Every endpoint except `/health` and the audio relay needs `Authorization: Bearer <Supabase access token>`. Verified tokens are cached for up to 5 minutes. Every endpoint except `/health`, the audio relay and `/me/access` also needs an **approved** account (see Access approval); others get `403` with `detail.code` of `access_pending` or `access_rejected`.

---

## Supabase Tables

Run these SQL scripts in your Supabase project under **SQL Editor → New Query**:

```sql
-- 1. songs
CREATE TABLE IF NOT EXISTS songs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_id    text NOT NULL UNIQUE,
  title         text NOT NULL,
  channel_name  text NOT NULL,
  thumbnail_url text,
  duration_sec  integer,
  language      text,
  genre         text,
  play_count    integer NOT NULL DEFAULT 0,
  added_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_songs_genre    ON songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_language ON songs(language);

-- 2. playlists
CREATE TABLE IF NOT EXISTS playlists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);

-- 3. playlist_songs
CREATE TABLE IF NOT EXISTS playlist_songs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id     uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, song_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist ON playlist_songs(playlist_id, position);

-- 4. liked_songs
CREATE TABLE IF NOT EXISTS liked_songs (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_id  uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  liked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, song_id)
);
CREATE INDEX IF NOT EXISTS idx_liked_songs_user ON liked_songs(user_id, liked_at DESC);

-- 5. play_history
CREATE TABLE IF NOT EXISTS play_history (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_id   uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  played_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_play_history_user ON play_history(user_id, played_at DESC);
```

Then run `recs_schema.sql` (the recommendation engine's tables: `listening_events`, `song_feedback`, `related_songs`) and `access_schema.sql` (`user_access`, below).

### Security (RLS and grants)

Run `harden_security.sql` (in this folder) in the SQL Editor once, after creating the tables, and again after any schema change. The app only reaches data through this backend, which uses the service-role key, so the script:

- removes all direct table access for `anon` (anyone holding the app's public key) and `authenticated` (any signed-in user);
- keeps RLS on with own-rows-only policies as a second line of defence, and makes the shared `songs` catalogue read-only to users;
- stops new tables from being auto-granted to those roles.

The queries at the end of the script show the result: no grants for the public roles, RLS on for every table. When you add a table, enable RLS on it as well.

---

## Access approval

Anyone can sign up (email and password, or Google), but nobody uses the API until the owner approves them.

1. `access_schema.sql` creates `public.user_access` (`user_id`, `email`, `provider`, `status` = `pending` | `approved` | `rejected`, `requested_at`, `decided_at`, `notified_at`) and a trigger on `auth.users` that adds a `pending` row for each new user and calls the `notify-signup` Edge Function through `pg_net`. Existing users are seeded as `approved`. The email step is best effort: a failure never blocks sign-up.
2. `notify-signup` emails the owner with Approve and Decline links. `review-signup` shows a confirm page, and its button records the decision and emails the user "You're in". Setup, secrets and deploy: `../supabase/functions/README.md`.
3. `auth.py` `get_current_user` (the dependency every route uses) verifies the token, then checks `user_access.status`: approved users are cached 10 minutes, pending or rejected 30 seconds, a missing row counts as pending, a database error gives `503`. Not approved gives `403` with `detail = {"code": "access_pending" | "access_rejected", "message": "..."}`. `get_signed_in_user` checks the token only; only `GET /me/access` uses it.
4. The audio relay needs no check: its signed links come only from `/youtube/stream`, which requires approval.

To approve or block someone by hand: `update public.user_access set status = 'approved', decided_at = now() where email = '...';` (the backend notices within 30 seconds, or 10 minutes when revoking).

Run order: `recs_schema.sql`, `access_schema.sql`, `harden_security.sql`.

---

## Playlist import

`POST /import/preview` takes `{url}` or `{text}` (exactly one) and returns the name, cover, owner and up to 500 tracks (`title`, `artists`, `album`, `duration_sec`, and `youtube_id` only when the source is YouTube). `POST /import/jobs` takes the same plus optional `name` and `description`, matches every track in the background, then creates the playlist in source order. The app polls `GET /import/jobs/{job_id}` (`status`: `queued`, `matching`, `creating`, `done`, `failed`; each item is `pending`, `matched` or `not_found` with a `confidence`). A cancelled import ends as `failed` with `error: "Import cancelled."`. Unreadable links return `422` with a plain `detail` that says what to do.

| Source | What is read | Limit |
|---|---|---|
| YouTube / YouTube Music playlist (`youtube.com/playlist?list=`, `watch?v=..&list=`) | yt-dlp flat listing, no login or cookies | Private, deleted and unavailable entries are skipped. These tracks need no matching |
| Spotify playlist or album (`open.spotify.com/...`, `intl-xx`, `?si=` ok) | The public embed page `open.spotify.com/embed/...` | The embed shows **100 songs at most** per playlist, so a 100-song result is `partial: true` with a note. Albums are complete |
| Apple Music playlist or album | The public page: JSON-LD plus the page's server data | Whatever the page lists; if it declares more songs than it lists, `partial: true` |
| Other sites | schema.org JSON-LD `MusicPlaylist` / `MusicAlbum` with `track`; on `jiosaavn.com`, the page state JioSaavn serves to every visitor | No track list on the page: `422` suggesting a pasted list. These report `source: "jsonld"` |
| Pasted text | One song per line: `Song - Artist`, `Artist - Song`, `1. Song by Artist`, `Song (feat. X)`; numbering, bullets and timestamps are dropped. A pasted list of YouTube links works too (titles come from YouTube's public oEmbed) | 500 songs; 150 YouTube links |

A lone `A - B` line is ambiguous, so both readings are searched and search results decide.

**Matching** (`importer/match.py`): each song is searched as `"{title} {first artist}"`, then `"{title} {artists} audio"`, through the same cached yt-dlp search as `/youtube/search`. 3 searches run at once per job, 4 overall. Each result gets a 0 to 1 confidence from title similarity (token set and sort ratio, pure Python), artist overlap with channel and title, official or `- Topic` or label channel, duration (within 8 s strong, 20 s fine, over 60 s off), penalties for live, cover, remix, slowed, reverb, 8D, karaoke, instrumental, sped-up and "lyrics" uploads unless the source title has that variant, and penalties for compilations and non-music. The best result is accepted at 0.55 or more; otherwise the song is `not_found` (its best confidence is still reported). Matched songs are added to the shared catalogue as they are found (insert-only, existing rows are never changed). A job with no matches ends `failed` and creates no playlist.

**Jobs** live in memory, per user: 2 running at once (a third `POST /import/jobs` gets `429`), 20 kept, gone after 2 hours or a restart. Only the owner can read or cancel a job; anyone else gets `404`.

**Boundaries.** Import reads only public pages, the way a browser opening the link would:

- One ordinary HTTPS GET per page with a normal browser User-Agent, timeouts, a 5 MB cap and no retry loops. No cookies, login, OAuth or API keys, no private or token-gated APIs (the session token Spotify puts in its embed page is never read), no paid scraping, no proxies, fingerprint tricks, captcha solving or rate-limit evasion. The server's own YouTube cookies are never used for imports.
- Because the server fetches links on a user's behalf, it refuses non-public hosts (loopback, private and link-local addresses, odd ports), on every redirect hop too.
- Fetched pages are untrusted data: parsed with `json.loads` and regex only, never evaluated. Logs show host and path only (plus YouTube's `list` id), never query strings.
- A service that shows only part of a playlist publicly is imported as far as it goes, with `partial: true` and a note saying so.

---

## Tests

```powershell
venv\Scripts\python -m unittest discover -s tests
```

The suites use fakes for the database and yt-dlp, so they need no `.env` and no network.

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Supabase not configured` | Check your `.env` — SUPABASE_URL and SUPABASE_KEY must be set |
| `SUPABASE_JWT_SECRET not configured` | Add JWT Secret from Supabase Project Settings → API |
| `ModuleNotFoundError` | Run `pip install -r requirements.txt` with venv active |
| `(venv)` not shown | Run `venv\Scripts\activate` first |
| `HTTP Error 429: Too Many Requests` in the log; the app says "YouTube is busy" | YouTube is rate-limiting this server's IP. The backend pauses yt-dlp (10 s, doubling up to 5 min) and serves cached links meanwhile; the app waits instead of retrying. If it never clears, the IP itself is throttled (Render's free plan is, see `docs/DEPLOY.md`): move the backend to a host with its own IP. |
