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
SUPABASE_KEY=your-supabase-service-role-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
```

> Get these from your Supabase project:
> - **SUPABASE_URL** → Project Settings → API → Project URL
> - **SUPABASE_KEY** → Project Settings → API → `service_role` secret key
> - **SUPABASE_JWT_SECRET** → Project Settings → API → JWT Secret

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
| GET | `/health` | Health check |
| GET | `/youtube/search?q=` | Search YouTube |
| GET | `/youtube/stream?id=` | Get audio stream URL |
| GET | `/songs` | List song catalogue |
| POST | `/songs` | Save song to catalogue |
| GET | `/genres` | List genres with count |
| GET `/POST /DELETE` | `/liked` | Liked songs |
| GET `/POST` | `/history` | Play history |
| GET `/POST /PUT /DELETE` | `/playlists` | Playlists CRUD |
| GET | `/search?q=` | Search catalogue |
| * | `/admin/*` | Admin-only operations |

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

### Row-Level Security (RLS)

```sql
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON songs FOR SELECT USING (true);
CREATE POLICY "Authenticated write" ON songs FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own playlists" ON playlists FOR ALL USING (auth.uid() = user_id);

ALTER TABLE playlist_songs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own playlist songs" ON playlist_songs FOR ALL
  USING (EXISTS (SELECT 1 FROM playlists WHERE playlists.id = playlist_songs.playlist_id AND playlists.user_id = auth.uid()));

ALTER TABLE liked_songs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own likes" ON liked_songs FOR ALL USING (auth.uid() = user_id);

ALTER TABLE play_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own history" ON play_history FOR ALL USING (auth.uid() = user_id);
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Supabase not configured` | Check your `.env` — SUPABASE_URL and SUPABASE_KEY must be set |
| `SUPABASE_JWT_SECRET not configured` | Add JWT Secret from Supabase Project Settings → API |
| `ModuleNotFoundError` | Run `pip install -r requirements.txt` with venv active |
| `(venv)` not shown | Run `venv\Scripts\activate` first |
