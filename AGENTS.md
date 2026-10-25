# AGENTS.md — RagaStream

Guidance for any AI agent (Claude, Codex, Cursor, Copilot…) working in this repo. Read this before changing code. Where this file and your defaults disagree, this file wins; where the user's words disagree with this file, the user wins.

## Vision

RagaStream is a personal, ad-free Indian music streaming app for Android (YouTube audio via yt-dlp, FastAPI + Supabase backend, Expo / React Native frontend). Feature parity with Spotify is the floor, **not** the look: the UI must be distinctive, world-class and unmistakably ours.

Users should finish a session feeling **they made something**: a playlist, a library, a taste that's recognised. Three feelings guide every decision: **effortless, crafted, recognised** (see `docs/USER_STORIES.md`).

## Sources of truth

| Topic | File |
|---|---|
| Who it's for, journeys, acceptance criteria | `docs/USER_STORIES.md` |
| Visual system: brand, colour, type, spacing, motion, components | `frontend/DESIGN.md` |
| Layout of Now Playing, Queue, Library, Mini player | `docs/SIGNATURE_LAYOUTS.md` |
| Recommendation engine: signals, ranking, surfaces, API | `docs/RECOMMENDATIONS.md` |
| Design tokens in code | `frontend/constants/theme.ts` |
| Backend endpoints and schema | `backend/README.md`, `backend/schemas.py` |
| Product requirements (local only, gitignored) | `prd.txt` |

**Brand:** the design system is **Meend** (the glide between two notes): Kesar `#FF7A1A` for the one primary action per screen, Neel for signals, Ink / Porcelain bases, Bricolage Grotesque + Geist + Geist Mono, light and dark themes. Read `frontend/DESIGN.md` before touching UI.

## Repo map

```
backend/            FastAPI app (routers/: youtube, media, playlists, liked, history, songs, search, admin, events, recs)
  recs/             recommendation engine: graph, profile, candidates, features, ranker, rerank, surfaces
  tests/            unittest suites (fakes only: no network, no DB)
frontend/
  screens/          one file per screen
  components/       shared UI (SongRow, SongActionsHost, sheets, MiniPlayer…)
  services/         playbackController, audioPlayer, libraryActions, apiClient, haptics
  store/            zustand: playerStore, settingsStore, songMenuStore, authStore
  hooks/            React Query hooks (useLiked, usePlaylists, useHistory, useLyrics, useArtworkColor)
  components/ui/    the UI kit: Text, Button, IconButton, Chip, Tappable, TextField, Toggle, Segmented, SheetRow, EmptyState, Toast…
  motion/           hand-authored motion: primitives (press, rise), Rise, flight (glide flight), PlayPauseIcon
  theme/            ThemeProvider (System/Light/Dark, makeStyles), prahar (time-of-day wash)
  constants/theme.ts  tokens
docs/               user stories and product docs
```

## Commands

```bash
# Backend (Windows, from backend/)
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
venv\Scripts\python -m unittest discover -s tests   # backend tests — must pass before you commit

# Frontend (from frontend/)
npm run dev                      # Expo with LAN host from .env
npx tsc --noEmit -p .            # typecheck — must be clean before you commit
npx expo export --platform android --output-dir <tmp>   # full bundle check for import/worklet errors
```

The backend has unittest suites in `backend/tests/` (fakes only); the app has none yet. Before saying something works, run the tests, typecheck, bundle, and exercise the logic you changed. Say plainly what you could not verify (e.g. gestures need a real device).

## Architecture rules (non-negotiable)

1. **Playback goes through `services/playbackController.ts`.** Call `playSongs(songs, index, context)`, `startRadio`, `addToQueue`, `playNext`, `next`, `previous`, `togglePlay`, `seek`. Never call `TrackPlayer` directly from UI and never write `currentTrack` / `queue` into `playerStore` from a screen. `audioPlayer.ts` is a one-track engine (expo-audio everywhere: Expo Go and installed builds, with lock-screen controls in builds; react-native-track-player and expo-av are gone) and knows nothing about queues. Audio is always loaded from the backend relay, never from a YouTube URL directly: YouTube locks stream URLs to the extracting IP, so a phone that hops to mobile data would get 403s mid-song. Get the link from `GET /youtube/stream` (`audio_path`, signed, valid 12h); players can't send our auth header, so the relay checks that signature instead.
2. **Song actions are global.** Open the menu with `openSongMenu(song, options)` and the save sheet with `openSaveSheet(song)`. Don't build per-screen menus.
3. **Library mutations live in `services/libraryActions.ts`** (like, save to playlist, remove, share, create). They update the React Query cache. Query keys: `['liked']`, `['playlists']` (summaries), `['playlist', id]`, `['playlist-containing', youtubeId]`, `['history', …]`.
4. **Persisted user preferences live in `store/settingsStore.ts`.**
5. Keep yt-dlp current (`pip install -U yt-dlp`). A `googlevideo.com` 403 on playback almost always means YouTube changed and yt-dlp needs updating, not an app bug.
6. **Caching.** React Query is the app's cache (`services/queryClient.ts`): 5-minute `staleTime`, and the library families (`liked`, `playlists`, `playlist`, `history`, `songs`, `lyrics`, `artwork-color`, `genre-home`, `recs-home`, `feedback`) are saved to AsyncStorage for 7 days. When you add a query family, add it to `SAVED` only if it is per-user library data or a slow, stable lookup; bump `CACHE_VERSION` if you change the shape of a saved response. Mutations must update or invalidate the cache (that's what makes the long `staleTime` safe). `clearQueryCache()` runs on sign-out. The backend keeps in-memory caches too: stream links until shortly before YouTube's own expiry (up to 4 h), search 30 min, radio 1 h, lyrics and colours 24 h, recommendation profile 2 min, Home recs 3 h (they reset when uvicorn restarts). The Mix graph is also stored in `related_songs` for 7 days.
7. **Recommendations come from the engine** (`backend/recs/`, `/recs/*`, spec in `docs/RECOMMENDATIONS.md`). The app asks `services/recsService.ts`; only `playbackController.ts` may fall back to `/youtube/radio` when the engine fails. Listening signals (start / skip / complete) are logged by the controller through `services/eventLog.ts`; library actions log like / save / queue. "Hide" and "Don't recommend this channel" go to `/feedback` (the local list is only an offline mirror). Every recommended item carries its slate's `rec_id`; keep it on the track so outcomes can train the ranker. On Home, engine output replaces or merges into existing sections; it never just adds rows.
8. **Security.** Every backend endpoint requires a signed-in user (`get_current_user`, router-level in `main.py` or per route) except `/health` and the signed audio relay; new accounts start `pending` and the owner must approve them, and that gate lives in `get_current_user` in `auth.py` (only `/me/access` uses the ungated `get_signed_in_user`); user-data queries also filter by `user_id`. The DB client uses the service-role key; the public roles (`anon`, `authenticated`) have **no** table access (`backend/harden_security.sql`), so the app must never query Supabase tables directly — add a backend endpoint instead. New tables: enable RLS and re-run that script. Don't log secrets or tokens; never commit `.env` or `backend/cookies.txt`.
9. **YouTube rate limits.** Every yt-dlp call goes through `backend/ytguard.py` (`gate.run(fn)`, passing its `log` to yt-dlp as `logger`): at most 2 at once, and after a 429 a cooldown of 10 s doubling to 5 min (plus jitter; a longer Retry-After wins) during which calls fail fast with `YouTubeBusy`. Routers turn that into HTTP 429 + `Retry-After`, serving stale cache where they have it. Never call yt-dlp outside the gate, and never retry a 429 straight away: in the app, `services/rateLimit.ts` tells you how long to wait.

## Design rules

- **Build from the kit.** Text only through `ui/Text` with a type role; buttons through `ui/Button` / `ui/IconButton`; sheets with `SheetRow`; confirmations with `confirmModal` (never native `Alert`); toasts with `services/toast`.
- **Tokens only.** Colours, type, spacing, radii and durations come from `constants/theme.ts`, read through `useColors()` / `makeStyles()`. No hex literals in screens except white/ink on artwork-tinted surfaces. If a token is missing, add it to the theme and DESIGN.md together.
- **Both themes, always.** Every screen must work in light and dark (and follow the system by default). Check contrast: 4.5:1 for body text, 3:1 for large text and icons.
- **Spacing**: 4pt base grid, 16pt screen gutter, consistent inner padding for repeated elements (Figma alignment and proximity).
- **One primary action per screen**, styled as the brand action. Everything secondary is quieter.
- **Touch targets ≥ 44×44pt.** Every gesture has a visible alternative.
- **Copy**: plain, specific, active voice. Name things the way users do ("Liked Songs", not "favourites collection"). Errors say what happened and how to fix it.
- **Avoid generic AI-looking UI**: no default purple-to-blue gradients, no Inter/Space Grotesk, no emoji as icons, no identical rounded cards stacked everywhere, no centre-everything layouts.

## Motion rules

Motion is part of the brand and is **authored by hand**:

- Build animations with Reanimated primitives (`useSharedValue`, `withTiming`, `withSequence`, `interpolate`) and our own curves and durations from `Motion` in `constants/theme.ts`.
- Reuse the vocabulary in DESIGN.md §6 (Press, Rise, Glide flight, Inchworm, Pour, Morph, Breath, Draw, Celebrate) before inventing a new motion.
- **Don't use canned presets**: no Reanimated layout-animation presets (`FadeIn*`, `SlideIn*`, `ZoomIn*`, prebuilt `Keyframe` recipes copied from docs), no Moti presets, no Lottie packs. If an element enters, choreograph it.
- Apply the 12 principles deliberately: ease-out to enter, ease-in to exit; interactions under 300ms (justify anything longer); stagger lightly; exaggerate only for milestone moments.
- **No decorative loops.** Infinite animation is only for loading and "now playing" indicators.
- Every animation has a job: feedback, orientation (where did this come from / go to), or delight at an earned moment. If it has none, remove it.
- Respect reduce-motion: replace movement with a short opacity change.

## Workflow

- Work on `main` only if the user asks; otherwise branch. Commit only when asked.
- Conventional commits scoped by area: `feat(frontend): …`, `fix(backend): …`, `docs: …`, `chore: …`.
- Keep commits logical (backend and frontend separate where possible).
- When you change the design system, update `frontend/DESIGN.md` in the same change.
- When you add a user-facing feature, check it against `docs/USER_STORIES.md` and add or update a story if needed.

## Definition of done for a screen

- [ ] Traces to user stories; one clear primary action
- [ ] Tokens only; light and dark both checked
- [ ] Loading, empty, error and offline states designed
- [ ] Touch targets, labels and contrast meet the accessibility rules above
- [ ] Motion follows the motion rules; reduce-motion handled
- [ ] Typecheck clean; logic exercised; unverified parts called out
