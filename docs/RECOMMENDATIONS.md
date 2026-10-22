# RagaStream recommendations ("Raag engine")

How RagaStream decides what to play next and what to put on Home. This is the contract between the backend engine, the API and the app. Change it in the same commit as the code.

## Why it looks like this

YouTube's recommender (Covington et al., *Deep Neural Networks for YouTube Recommendations*, 2016, plus YouTube's later write-ups) has four parts: **collect signals → generate candidates → rank → re-rank with constraints**, and it learns from the response. It optimises for **satisfaction**, not clicks: watch time, completion, likes and explicit "not interested" outweigh a tap.

We copy the architecture, not the scale:

| YouTube | RagaStream |
|---|---|
| Billions of users for collaborative filtering | YouTube's own Mix playlists (`RD<id>`) *are* our collaborative signal. We store every Mix we fetch as a **related-songs graph** and walk it. |
| Neural candidate generator | Multi-source retrieval: graph neighbours of your seeds, 2-hop walks, channel affinity, rediscovery, the catalogue. |
| Learned ranking model on watch time | A linear scorer over interpretable features, hand-weighted at first; `train.py` fits the weights from logged outcomes once there is enough data. Features are logged at serve time, as YouTube does, so training never needs to recompute them. |
| Satisfaction surveys | Completion, likes, saves and replays are positive; early skips and hides are negative. |
| Per-surface models | One engine, a profile of weights per surface (autoplay, radio, Smart Shuffle, playlist, Home). |
| Online user state | The **session**: the last 45 minutes of events steer the very next batch (two skips of one channel and it backs off now, not tomorrow). |

The result has to feel **recognised** (USER_STORIES.md): every pick carries a reason the app can show ("Because you played Kun Faya Kun").

## Data

Run `backend/recs_schema.sql` in the Supabase SQL editor, then re-run `backend/harden_security.sql` (it now covers the new tables).

### `listening_events` (per user, append-only)

| column | type | notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `user_id` | uuid not null → auth.users on delete cascade | |
| `youtube_id` | text not null | |
| `song_id` | uuid null → songs on delete set null | when known |
| `event` | text not null, check in (`start`,`skip`,`complete`,`like`,`unlike`,`save`,`queue`,`hide`) | |
| `surface` | text not null default `other`, check in (`autoplay`,`radio`,`smart_shuffle`,`home`,`playlist_recs`,`search`,`library`,`playlist`,`liked`,`channel`,`queue`,`other`) | where the song was played or acted on from |
| `context_id` | text null | playlist id, radio seed, etc. |
| `rec_id` | text null | the slate id from a `/recs/*` response, if the song came from one |
| `listened_sec` | real null | for `skip` / `complete` |
| `duration_sec` | real null | |
| `local_hour` | smallint null, 0–23 | the phone's hour when it happened |
| `features` | jsonb null | ranking features attached **by the server** from the slate cache; never sent by the app |
| `created_at` | timestamptz not null default now() | |

Indexes: `(user_id, created_at desc)`, `(user_id, youtube_id)`. Keep at most 5,000 rows per user (trim oldest in a background task, like history).

### `song_feedback` (per user, explicit)

| column | type | notes |
|---|---|---|
| `user_id` | uuid not null → auth.users on delete cascade | |
| `target_type` | text not null, check in (`song`,`channel`) | |
| `target_id` | text not null | youtube_id, or the channel name exactly as shown |
| `kind` | text not null, check in (`hide`) | room for `more`/`less` later |
| `label` | text null | the song title or channel name, for Settings |
| `created_at` | timestamptz not null default now() | |
| primary key | (`user_id`, `target_type`, `target_id`) | |

### `related_songs` (shared, derived from YouTube Mixes)

| column | type | notes |
|---|---|---|
| `seed_id` | text not null | youtube_id the Mix was built from |
| `youtube_id` | text not null | a song in that Mix |
| `rank` | smallint not null | 1 = first after the seed |
| `title`, `channel` | text not null | |
| `duration` | integer not null default 0 | seconds |
| `fetched_at` | timestamptz not null default now() | |
| primary key | (`seed_id`, `youtube_id`) | index on `youtube_id` for reverse lookups |

Mix rows are fresh for 7 days; after that the next request refetches the Mix and replaces the seed's rows.

All three tables: RLS on. `listening_events` and `song_feedback` get "own rows" policies; `related_songs` gets "Signed-in read" (like `songs`). No grants to `anon` / `authenticated`.

## Signals and what they mean

Labels the profile and the trainer use. A `skip` is "the listener moved on before 80% of the song and it didn't end on its own".

| event | weight in affinity | label for training |
|---|---|---|
| `complete` (≥ 80% or ended) | +1.0 | positive |
| `skip` at < 30 s | −1.0 | negative |
| `skip` at 30 s – 50% | −0.4 | negative (weak) |
| `skip` at 50 – 80% | 0 | ignored |
| `like` | +3.0 | positive |
| `unlike` | −2.0 | — |
| `save` (to a playlist) | +2.5 | positive |
| `queue` (add to queue / play next) | +1.5 | positive |
| `hide` | excluded forever (song), or channel excluded | negative |
| `start` | 0 (impression only) | — |

Affinity decays with a **30-day half-life**. Liked songs and playlist songs also count as standing affinity (+2.0 and +1.5 at their added date). The latest 200 `play_history` rows count as weak affinity (+0.5) and as last-played times, so listeners with history from before the engine aren't treated as new.

Private session: the app sends no `start`/`skip`/`complete` events. Explicit actions (like, save, hide) still count, because the listener asked for them.

## Engine (`backend/recs/`)

| module | job |
|---|---|
| `graph.py` | `async get_related(youtube_id) -> list[Related]`: memory cache → `related_songs` (≤ 7 days old) → yt-dlp Mix fetch (`youtube.fetch_mix`) → persist. At most 3 yt-dlp fetches at once (semaphore). `async neighbours(ids, depth=1)`. `similarity(a, b)`: Jaccard of the two Mixes' neighbour sets plus 1 if either contains the other. |
| `profile.py` | `async load_profile(user_id) -> Profile`: song affinity, channel affinity (both decayed), skip counts, last-played time per song, liked set, playlist set, hidden songs and channels, the channel × hour histogram, variant taste (slowed/lofi/remix), and the **session** (events in the last 45 min). Cached for 2 minutes per user; `POST /events` invalidates it. |
| `candidates.py` | Sources, each tagging the candidates it found: `seed` (Mix of the seed), `session` (Mixes of songs completed this session), `taste` (Mixes of top-affinity songs), `walk` (2-hop from seeds, discounted), `channel` (catalogue songs from top channels), `rediscover` (liked or high-affinity, not played in 30+ days), `catalogue` (most-played songs across users; cold start). |
| `features.py` | Per candidate: `consensus` (how many seeds link to it, log-scaled), `mix_rank` (best rank, 1/√rank), `seed_sim`, `song_aff`, `channel_aff`, `skip_penalty`, `fatigue` (played in the last 24 h / 3 days), `novelty` (never played), `hour_fit` (this channel's share of plays at this hour), `variant_fit`, `quality` (non-music and junk penalty), `session_steer` (channel skipped or completed this session). All floats in roughly [−1, 1]. |
| `ranker.py` | `score = Σ wᵢ·fᵢ` with per-surface weights from `weights.py` (or `weights.json` written by `train.py`). |
| `rerank.py` | Hard filters (hidden, same song by normalised title, duration < 60 s or > 20 min unless the user plays long tracks, already in the queue). Then a greedy MMR pass: same channel at most once in any 3 consecutive slots (radio: never twice in a row, to keep the Mix's flow; Home sections: at most 2 per row). When one label channel holds most of the top picks, the next-best song from another channel takes the slot (reordering alone can't space 9 T-Series songs in 15), and **exploration**: a share of slots (per surface) goes to novel candidates sampled from the top 3× by score, so the engine keeps learning. |
| `text.py` | **Labels are not artists.** Most Indian music is uploaded by label channels (T-Series, Zee Music Company, Sony Music India, Saregama, Tips, YRF, Coke Studio …). `is_label` detects them; for label uploads the artist comes from credits in the title that recur across your songs (composer duos such as Ajay-Atul stay whole). Mixes are named "{Artist} Mix", or "{Song} Mix" when no credible artist exists, never after a label. Seeds whose title is a label name or blank are skipped. Also title normalisation (strip "(Official Video)", "[Lyrics]", "| T-Series", "Lyrical", "Full Song", "Audio", "4K", ft./feat. lists), variant detection (`slowed`, `reverb`, `lofi`, `remix`, `unplugged`, `cover`, `live`), and the non-music filter (`reaction`, `review`, `interview`, `podcast`, `trailer`, `teaser`, `#shorts`, `status`, `whatsapp status`, `ringtone`). |
| `slates.py` | Builds a slate for a surface, gives it a `rec_id`, and remembers each item's features (in memory, 6 h, max 2,000 slates) so `POST /events` with that `rec_id` stores the features on the event. |
| `reasons.py` | Picks the reason for each item from its strongest source and feature. |
| `evaluate.py` | Offline: time-based split of each user's events (train on the past, test on the last 20%). Recall@K, NDCG@K, catalogue coverage, intra-list channel diversity, against a popularity baseline and raw YouTube Mix order. Runs on fixtures or, with `--live`, the real DB (read-only). |
| `train.py` | Fits logistic-regression weights per surface from events with `features` and a label. Refuses with fewer than 300 labelled events for a surface. Writes `weights.json` only if offline NDCG beats the current weights. Pure Python, no new dependencies. |

### Surface profiles (starting weights)

| feature | autoplay | radio | smart_shuffle | playlist | home |
|---|---|---|---|---|---|
| consensus | 1.0 | 0.8 | 1.2 | 1.4 | 1.0 |
| mix_rank | 0.8 | 1.2 | 0.6 | 0.6 | 0.5 |
| seed_sim | 1.2 | 1.4 | 1.0 | 1.0 | 0.6 |
| song_aff | 0.6 | 0.3 | 0.5 | 0.4 | 1.0 |
| channel_aff | 1.0 | 0.4 | 0.6 | 0.5 | 1.0 |
| skip_penalty | −1.5 | −1.0 | −1.5 | −1.0 | −1.5 |
| fatigue | −1.2 | −0.8 | −1.0 | −0.5 | −1.0 |
| novelty | 0.3 | 0.5 | 0.4 | 0.6 | 0.4 |
| hour_fit | 0.3 | 0.1 | 0.2 | 0.0 | 0.5 |
| variant_fit | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 |
| quality | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| session_steer | 1.0 | 0.6 | 0.8 | 0.0 | 0.3 |
| **exploration share** | 15% | 20% | 15% | 25% | 15% |

These are starting points; `evaluate.py` and `train.py` exist to move them. `skip_penalty` reads a song's net negative affinity, `min(1, max(0, −song_aff))^1.5`: an early skip counts 1.0, a 30 s–50% skip about 0.25, and a skipped song you later finished or liked counts 0 (plus the channel's skip share).

**Tuning log (2026-10-22).** Mean NDCG@10 over 8 seeds × 40 synthetic users, in a clean world and a deliberately noisy one (42% cross-cluster Mixes, channels shared by labels, fewer plays). A change is kept only if it helps both, or costs less than noise.

| world · surface | engine before | engine now | popularity | raw Mix |
|---|---|---|---|---|
| clean · home | 0.352 | 0.416 | 0.223 | 0.394 |
| clean · autoplay | 0.342 | 0.403 | 0.223 | 0.295 |
| noisy · home | 0.256 | 0.263 | 0.163 | 0.304 |
| noisy · autoplay | 0.208 | 0.216 | 0.163 | 0.257 |

When channels say nothing about taste and Mixes are noisy, YouTube's own order still wins; the real data's logged `features` (via `train.py`) is how that gap closes. A faster decay for mid-song skips needs skip timestamps in `profile.py` (not done).

### Cold start

No events yet: `taste` falls back to liked songs and playlist songs; with none of those, `seed` + `catalogue`. A brand-new user gets YouTube Mix order, lightly de-duplicated, which is what the app does today: never worse than before.

## API

All routes need a signed-in user. Errors follow the house style (`detail` says what happened and how to fix it). Every route degrades instead of failing: if yt-dlp is down, slates come from the stored graph and the catalogue.

```
RecItem = {
  youtube_id: str, title: str, channel: str, duration: int, thumbnail: str,
  reason: str,          # shown in the app, e.g. "Because you played Tum Hi Ho"
  reason_code: "seed" | "session" | "taste" | "walk" | "channel" | "rediscover" | "catalogue" | "discover",
}
Slate = { rec_id: str, surface: str, items: RecItem[] }
```

| method | path | body / query | returns |
|---|---|---|---|
| GET | `/recs/next` | `seed` (youtube_id), `exclude` (comma-separated youtube_ids, ≤ 200), `limit` 1–30 (default 15) | `Slate` (surface `autoplay`) |
| GET | `/recs/radio` | `seed`, `limit` 1–50 (default 30) | `Slate` (surface `radio`), in flow order, seed not included |
| POST | `/recs/shuffle` | `{ current: str \| null, context: str[] (≤ 200), exclude: str[] (≤ 200), limit: 1–30 }` | `Slate` (surface `smart_shuffle`) |
| POST | `/recs/playlist` | `{ youtube_ids: str[] (≤ 200), exclude: str[], limit: 1–30 }` | `Slate` (surface `playlist_recs`) |
| GET | `/recs/home` | `hour` 0–23 | `HomeRecs` (below) |
| POST | `/events` | `{ events: Event[] (1–50) }` | 202 `{ accepted: int }` |
| GET | `/feedback` | | `Feedback[]` |
| POST | `/feedback` | `{ target_type, target_id, kind: "hide", label? }` | 201 `Feedback` (idempotent) |
| DELETE | `/feedback/{target_type}/{target_id}` | | 204 |
| DELETE | `/feedback` | `?target_type=` optional | 204: clears all (or one type) |

```
Event = {
  youtube_id: str, event: <see table>, surface: <see table> = "other",
  context_id?: str, rec_id?: str, song_id?: str,
  listened_sec?: float, duration_sec?: float, local_hour?: 0..23,
  at?: ISO-8601 (client time; server clamps to [now − 7 days, now])
}

HomeRecs = {
  generated_at: ISO-8601,
  sections: [{
    id: str,                       # stable, e.g. "mix-arijit-singh", "discover", "rediscover", "because-<yt>", "hour"
    kind: "mix" | "discover" | "rediscover" | "because" | "hour",
    title: str,                    # "Arijit Singh Mix", "New to you", "Back on rotation", "Because you played …", "Your late-night set"
    subtitle: str,
    seed: RecItem | null,          # the song a mix or "because" row starts from
    rec_id: str,
    items: RecItem[]               # 8–20 each
  }]
}
```

Home is built per user and cached for 3 hours (memory); a fresh request after that rebuilds it. Feedback clears it; plain listening events clear only the profile (`invalidate_user(id, home=False)`), so Home doesn't rebuild after every batch. A section needs at least 4 items to appear; the 2-per-channel cap relaxes to 4, then none, when a row would be shorter than 8. `/recs/radio` answers 502 when it has nothing, so the app falls back to `/youtube/radio`; the other slates return empty. It contains up to 3 mixes (clusters of your taste by channel and graph neighbourhood), "New to you", "Back on rotation", up to 2 "Because you played" rows and an hour-of-day set. Empty sections are left out.

### Backend caches

| cache | lifetime |
|---|---|
| Mix graph in memory | 1 h (DB copy 7 days) |
| Profile | 2 min, cleared by new events or feedback |
| Slate features (for `rec_id`) | 6 h, max 2,000 slates |
| Home | 3 h per user, cleared by feedback |

## App

| piece | job |
|---|---|
| `services/recsService.ts` | Typed calls for every route above; `toSongInput(item)` keeps `rec_id`, `reason`, `reason_code`. |
| `services/eventLog.ts` | `logEvent(e)`: batches (flush at 10 events, after 20 s, or when the app goes to the background), keeps an AsyncStorage outbox so offline events survive, drops listening events in a private session. |
| `playbackController.ts` | Emits `start` / `skip` / `complete` with listened seconds and the track's `surface` and `rec_id`. Autoplay → `/recs/next`, radio → `/recs/radio`, Smart Shuffle → `/recs/shuffle`, each falling back to `/youtube/radio` if the call fails. **Steering:** two skips in a row of autoplay or Smart Shuffle picks replace the unplayed picks with a fresh `/recs/next` slate. |
| `Track` | gains `surface`, `recId`, `reason`. |
| `libraryActions.ts` | Like / unlike / save emit events once the server call succeeds (with the track's `rec_id` when it is the playing track). `queue` is emitted by the controller's `addToQueue` / `playNext`, so every caller counts. Hides are recorded by `/feedback` only (no separate `hide` event, so they aren't counted twice). Failed loads and stall-forced skips log nothing: they say nothing about taste. |
| Hiding | `hideSong` / `hideChannel` call `/feedback`; the local `hiddenYoutubeIds` list stays as an offline mirror and is uploaded once. Settings shows the count and a clear action backed by `DELETE /feedback`. |
| Playlist recommendations (US-11) | `/recs/playlist`. |
| Query keys | `['recs-home', hour]` (saved), `['feedback']` (saved). Feedback changes invalidate both. |

## Measuring it

- Offline: `python -m recs.evaluate` (fixtures) and `--live`. Report Recall@10, NDCG@10, coverage and diversity against the popularity and raw-Mix baselines. A change to weights or retrieval should not lower NDCG@10.
- Online (from `listening_events`): per-surface skip rate under 30 s, completion rate, saves per 100 recommendations, and the share of plays that came from recommendations. `GET /recs/metrics` (signed in, own data) returns these for the last 7 and 28 days.
