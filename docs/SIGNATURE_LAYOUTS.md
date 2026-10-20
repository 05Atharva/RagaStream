# RagaStream — Signature layouts

The layout of the four core surfaces, chosen 2026-10-20 by mixing three explored directions (*The Line*, *Liner Notes*, *The Deck*). Goal: Spotify feature parity, but a shape nobody mistakes for Spotify. Visual tokens, type, motion vocabulary and component kit come from `frontend/DESIGN.md`; this file defines **layout and behaviour** of:

1. Now Playing · 2. Queue · 3. Library · 4. Mini player · 5. Home

Rules that apply to all of them: build from `components/ui/*`, tokens only (`useColors`, `makeStyles`, `Motion`, `Space`, `Radius`, `Type`), both themes, ≥44pt targets, every gesture has a visible alternative, hand-authored motion only (no Reanimated layout presets), reduce-motion respected, playback only via `services/playbackController.ts`.

---

## 1. Now Playing — *Deck + Liner title + Meend line*

Top to bottom inside the existing scrolling page (keep header, gradient background, dismiss gesture, sheets, ReconnectingToast):

1. **Header** (unchanged): close · "Playing from …" + context name · ⋯ song menu.
2. **Deck** (`components/player/DeckArtwork.tsx`)
   - The current song is the top card: `FlipArtwork` (tap → flips to synced lyrics). The front carries a small "Tap for lyrics" tag (only when lyrics exist) so the flip is discoverable. On the lyrics side, the top-right corner opens `LyricsView`; the deck's own tap handler hit-tests that corner (no nested Pressable inside the gesture).
   - Up to **two next songs** (user queue first, then context) sit behind as cards: offset `translateY +12 / +24`, scale `0.93 / 0.86`, opacity `0.75 / 0.45`. Only their artwork shows.
   - **Flick to skip**: drag the top card sideways; it follows the finger and tilts (`rotate = x / width × 12°`). Past 22% width or fast flick → it flies off on an arc (`±1.3 × width`, `+40` down, `±18°`, `in` curve, 220ms), then the next card **promotes** from back1 to front (`out`, 280ms). Right-flick = previous (the card leaves right, the previous song enters from the left).
   - Exposes `ref.flick('next' | 'previous')` so the transport buttons trigger the same animation.
   - When the track changes on its own (auto-advance), the new top card promotes forward with the same 280ms motion.
3. **Liner title**: song title in `display` type, wraps up to 2 lines (no marquee); `LikeButton` to the right.
4. **Credits** (liner notes): one compact row of label/value pairs — labels in `label` style, values in `caption`/`mono`:
   `CHANNEL` → channel name (tap → Channel screen) · `FROM` → context name · `LENGTH` → duration (mono).
5. **Meend seek line** (`components/player/MeendSeek.tsx`): progress drawn as a gentle S-curve (the logo's glide), not a straight bar. Elapsed part in Kesar, remainder in the track colour, playhead dot rides the curve. Drag or tap anywhere to seek; the dot swells and a time bubble rises while scrubbing. Time row (mono) below.
6. **Arc controls** (`components/player/ArcControls.tsx`): shuffle · previous · **play** · next · repeat laid on a shallow upward arc (centre lowest, outer buttons highest) for thumb reach, with a faint arc line drawn behind them. Play = 72pt Kesar circle with `PlayPauseIcon`. Active shuffle/repeat in the active colour + dot; Smart Shuffle sparkle badge; repeat-one "1" badge.
7. **Utility row** (unchanged): sleep timer · speed · save · share · queue.
8. **Below the fold**: first **Lyrics as liner notes** (`LyricsCard`): artwork-tinted card, "Lyrics" label + mono status (`Synced · LRCLIB`), five lines with the sung line set in `headline` beside a 3pt Kesar marker (the elapsed-seek colour), the block rising as lines advance, and "Open full lyrics". The flip and this card are two routes to the same lyrics: the flip for a glance, the card for anyone who never taps the art. Then *Up next* as a 3-node mini timeline with "Open queue", then *About the channel*.

## 2. Queue — *Timeline + Setlist*

`components/QueueSheet.tsx`. One continuous vertical line runs down the left; each row draws its own segment so the line stays continuous through drag/reorder.

Order and colours:

| Section | Node | Line segment | Row |
|---|---|---|---|
| **Played** (last 3 of the context before the current song) | small hollow, tertiary | tertiary | number + title **crossed out** in tertiary (setlist) |
| **Now** | 14pt Kesar node with soft ring | Kesar | highlighted row, equalizer on art |
| **You queued** (user queue) | Neel filled | Neel | normal |
| **From {context}** | hollow, border colour | border | draggable via ≡ handle |
| **Autoplay** | hollow | **dashed** | normal |

- Every row: setlist number in mono (position in context, `01`, `02`…; user-queued rows show `+`), 40pt art, title + channel, ⋯ (closes the queue, then opens the song menu), ≡ handle where reorderable. Tap = play from there; swipe left = remove.
- Header: "Up next" + "N songs · about M min".
- Opening motion: the line **draws** down (scaleY 0→1 from the top, glide, 360ms) while rows Rise in staggered.

## 3. Library — *Bento collection + A–Z index*

`screens/LibraryScreen.tsx`.

1. Header: "Library" (display) · search · ＋ create (unchanged behaviour).
2. **Your collection** bento (2 columns, 84pt rows, `Radius.lg` tiles, Rise staggered):
   - Liked Songs: big tile (2 rows), Kesar→Neel gradient, heart, song count.
   - Up to 3 playlists (pinned first, then most recent): mosaic cover as tile background with a bottom scrim, name + count.
   - Top channel (by liked songs) as a wide tile.
   - "＋ New playlist" tile (opens the create sheet).
3. **Everything** index — ONE row anatomy for every item type (this fixes the inconsistency):
   - 52pt art · title (`subtitle`) · meta line in one format: `Playlist · 20 songs` / `Channel · 2 liked songs` / `Liked Songs · 4 songs` · trailing column: mono type tag (`PL` / `CH` / `♥`) with a Kesar pin above it when pinned.
   - Shape encodes type: playlists and Liked = rounded square (`Radius.sm`), channels = circle. Same size, same alignment.
   - Filter chips: All · Playlists · Channels. Sort: Recents · A–Z. In A–Z, big index letters (display type, tertiary) head each letter group.
   - The list/grid toggle is removed (the bento is the visual view).
4. Keep: long-press playlist sheet (Play / Pin / Delete via `confirmModal`), create sheet, search, skeletons, empty states.

## 4. Mini player — *Ring capsule + Deck edge*

`components/MiniPlayer.tsx` (positioned by `BottomTabNavigator`, unchanged).

- A floating **capsule** (`Radius.pill`, 56pt tall, 12pt side margins) tinted with the artwork colour as today.
- Left: **round artwork inside a progress ring** (SVG circle, Kesar on dark / accentInk on light, track at 20% ink). The ring *is* the progress; the old bottom progress line is removed.
- Middle: title + channel. Right: like · play/pause (`PlayPauseIcon`) · next.
- **Deck edge**: behind the capsule, the next song's card peeks out above it (92% width, `translateY −7`, scaled 0.94, 60% opacity, next song's tint). When you swipe to skip, the capsule flies off and the edge card promotes forward.
- Keep everything that works: rises on first track, tint crossfade, swipe to skip, tap to open, flight target registration (`setFlightTarget`) on the artwork, arrival bump, accessibility labels. Total height must stay within `Layout.miniPlayerHeight` + the 7pt peek.

## 5. Home — *Pick-up deck + Trail + Setlist*

`screens/HomeScreen.tsx`. Keeps the prahar wash, greeting, avatar and genre chips (a chip swaps the page for that genre's songs in place).

1. **Pick up where you left off** — the screen's one Kesar action. A surface card: on the left a small deck of your last three songs (104pt; the two behind fan out right with +16/+30pt and 4°/8° on arrival, `out`, 280ms); on the right label, title, channel, a 48pt Kesar play circle and a mono count (`12 recent songs`). Tap plays Recently played from the top. Before any history exists it becomes **Start here** with the featured songs.
2. **Your trail** — recent playlists, channels and radios on one horizontal line (the Queue's timeline turned sideways). Each stop: a node on the line (newest = filled Neel, others hollow), 64pt cover (circle for channels, rounded square otherwise), name, mono time-ago (`3h ago`, `Yesterday`). Liked Songs is always a stop. The line *draws* left→right on first mount (360ms, glide).
3. **Featured today** — editorial cards, mono `01 / 04` index, outlined white play (secondary, not Kesar).
4. **On repeat** — a numbered setlist (top 5): mono number, 44pt art, title/channel, plays as mono `12×`.
5. **Your mixes** — each mix is a deck: the top song's art in front, two offset blank cards behind.
6. **Quick picks** — 3-row columns that page sideways (from Liked Songs, or the catalogue).
7. **Recently played** — song cards, after the one already shown in Pick up.
8. **Your listening** — liner credits on a surface card: `PLAYS` · `TOP CHANNEL` · `TOP SONG` → Stats.

Every play shows its spinner on the item itself; errors are a toast with a fix. Reduce-motion: the fan and the line draw render at rest.
