---
name: RagaStream
system: Meend
colors:
  kesar: "#FF7A1A"      # action
  neel: "#6E8BFF"       # signal
  ink: "#0B0F1A"        # dark base
  porcelain: "#F5F6FA"  # light base
fonts:
  display: Bricolage Grotesque (600/700/800)
  body: Geist (400/500/600/700)
  mono: Geist Mono (500)
spacing: 4pt grid · gutter 20
radius: { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 }
motion:
  durations: [90, 140, 200, 280, 360, 900]
  glide: cubic-bezier(.65, 0, .35, 1)
  out: cubic-bezier(.16, 1, .3, 1)
  in: cubic-bezier(.7, 0, .84, 0)
  standard: cubic-bezier(.2, 0, 0, 1)
tokens: frontend/constants/theme.ts
---

# RagaStream · Meend design system

> **Meend** (मींड) is the glide between two notes. A singer doesn't jump from Sa to Pa; they travel. RagaStream is built from that idea: one continuous line, movement that travels on curves, and a single warm colour that tells you where to act.

This file is the source of truth for how RagaStream looks, reads and moves. Tokens live in `constants/theme.ts`; this document explains them. Change both together. Who we design for, and why, lives in `docs/USER_STORIES.md`.

---

## 1. Brand

**Personality:** premium, warm, crafted. Confident without shouting. It should feel like a well-made instrument, not a template.

**The feeling we design for** (from the user stories): *effortless* (music in two taps), *crafted* (building a playlist feels like arranging), *recognised* (the app notices what you love and marks it quietly).

**What RagaStream is not:** a purple-gradient "AI app", a Spotify clone, a neon arcade. No emoji as icons, no stock gradients, no centre-everything layouts.

## 2. Logo

**The mark** is one unbroken stroke: an R whose leg bends into a flowing line (the stream), landing on a Neel dot (the note it arrives at).

```
path  M14 54 V14 Q14 11 17 11 H33 Q47 11 47 23.5 Q47 36 33 36 H24
      C31 36 33 44 39 48.5 C44 52 49 49.5 52 45.5      (viewBox 0 0 64 64)
dot   circle cx 55.5 cy 41.5 r 3.6
stroke 6.5, round caps and joins · path length ≈ 149
```

| Use | Stroke | Dot |
|---|---|---|
| On Ink / dark | Kesar `#FF7A1A` | Neel light `#8FA5FF` |
| On Porcelain / light | Kesar `#E8620A` | Neel deep `#3F5BE0` |
| On a Kesar fill | Ink `#1A0B00` | Ink |

- **Wordmark:** "RagaStream" in Bricolage Grotesque ExtraBold, letter-spacing −2% of size. Lockup gap = 22% of mark size.
- **Clear space:** half the mark's width on every side. **Minimum size:** 20pt.
- **App icon:** Kesar mark on Ink, mark at 60% of the canvas (adaptive icon: 46%, inside the safe zone). Rendered from the path above; see `assets/`.
- **Don't:** recolour the stroke outside the table, add effects, outline it, or separate the dot from the stroke.
- **In motion:** the stroke draws itself on the glide curve (1100ms), and the dot lands with a squash and settle as the line arrives. Used on the splash, auth screens and milestones only (`components/Logo.tsx`).

## 3. Colour

### Brand palette
| Name | Hex | Role |
|---|---|---|
| **Kesar** (saffron) | `#FF7A1A` | The one primary action per screen. Play, Create, Done, the active tab marker. |
| **Neel** (indigo) | `#6E8BFF` / `#8FA5FF` / `#3F5BE0` | Signals: now-playing accents, Smart Shuffle picks, info, secondary data. |
| **Ink** | `#0B0F1A` | Dark-theme base. A blue-black, never pure `#000`. |
| **Porcelain** | `#F5F6FA` | Light-theme base. A cool off-white, never cream. |

### Semantic tokens (use these in UI, never raw hex)
| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#0B0F1A` | `#F5F6FA` | Screen background |
| `surface` | `#121828` | `#FFFFFF` | Cards, sheets, inputs |
| `surfaceRaised` | `#1A2133` | `#EDEFF5` | Chips at rest, nested surfaces |
| `surfacePressed` | `#232C42` | `#E2E6EF` | Pressed / toggle-off track |
| `text` | `#EEF1F8` | `#0B0F1A` | Primary text |
| `textSecondary` | `#A3ACC2` | `#4A5268` | Metadata, captions |
| `textTertiary` | `#7A84A0` | `#687089` | Placeholders, quiet icons |
| `accent` | `#FF7A1A` | `#FF7A1A` | Kesar fills |
| `onAccent` | `#1A0B00` | `#1A0B00` | Text/icons on Kesar (ink, not white: 7.4:1) |
| `accentInk` | `#FF8F3D` | `#B54A08` | Kesar as text or icon on the background |
| `accentSoft` | Kesar 14% | Kesar 12% | Selected and active backgrounds |
| `signal` | `#8FA5FF` | `#3F5BE0` | Neel accents |
| `danger` | `#FF5D6C` | `#C62839` | Destructive actions, errors |
| `success` / `warning` | `#3DD68C` / `#FFC24D` | `#12925A` / `#9A5B00` | Status |

### Rules
1. **One Kesar per screen.** The primary action gets the fill; everything else is quieter (Figma: hierarchy, contrast).
2. **Kesar fills carry ink text**, never white. White on saffron fails contrast.
3. **Neel never competes with Kesar.** It marks state (playing, recommended), not actions.
4. **Artwork tint:** playback surfaces take a palette from the current artwork (`GET /artwork/color` → `useArtworkColor`, `useHeroTint`). Dark theme uses deep tints fading into Ink; light theme uses pale washes (`mix(accent, bg, .72)`) fading into Porcelain. Tints crossfade over 360ms when the track changes.
5. **Prahar wash:** Home carries a soft ambient wash coloured by the time of day's raga watch (`theme/prahar.ts`), at 20% (dark) or 28% (light). The brand colours never change with time.
6. **Both themes, always.** System is the default; Light and Dark are chosen in Settings → Appearance.

### Contrast (WCAG 2.1)
Every text pair above meets AA (4.5:1 body, 3:1 large text and icons) in both themes; verified when the tokens were set. Notable: `textTertiary` on `bg` is 5.1 (dark) and 4.6 (light); `accentInk` on `bg` is 8.4 / 4.9.

## 4. Typography

Bricolage Grotesque speaks; Geist does the work; Geist Mono keeps time.

| Role | Font | Size / line | Tracking | Use |
|---|---|---|---|---|
| `hero` | Bricolage 800 | 44 / 46 | −1.4 | Auth titles, Liked Songs, big numbers |
| `display` | Bricolage 800 | 32 / 36 | −0.9 | Screen titles, greeting, playlist names |
| `headline` | Bricolage 700 | 24 / 28 | −0.5 | Section headers, Now Playing title |
| `title` | Bricolage 700 | 19 / 24 | −0.3 | Sheet titles, card titles, lyrics preview |
| `subtitle` | Geist 600 | 16 / 21 | −0.1 | Button labels, emphasised rows |
| `body` | Geist 400 | 15 / 22 | 0 | Running text |
| `bodyStrong` | Geist 500 | 15 / 21 | 0 | Song titles in rows |
| `caption` | Geist 400 | 13 / 18 | 0 | Metadata (channel, counts) |
| `captionStrong` | Geist 600 | 13 / 18 | 0 | Chips, small buttons, links |
| `label` | Geist 600 | 11 / 14 | +0.9, UPPERCASE | Eyebrows ("PLAYING FROM", "RIYAZ MILESTONE") |
| `mono` | Geist Mono 500 | 12 / 16 | +0.2, tabular | Time, durations, counts, speed |

- All text goes through `components/ui/Text.tsx` with a role. No ad-hoc `fontSize` in screens.
- Respect the system font scale (capped at 1.35× so layouts survive).
- Numbers that change (time, counts) are mono or tabular so they don't jitter.

## 5. Space, shape, elevation

- **4pt grid:** `Space[1]` = 4 … `Space[16]` = 64. **Screen gutter:** 20pt on both sides.
- **Touch targets:** ≥ 44×44pt (`Layout.touchTarget`). Song rows are 64pt tall with 48pt artwork.
- **Radius:** `xs 6` (tiny thumbs), `sm 10` (thumbnails, inputs, tiles), `md 14` (cards, mini player), `lg 20` (hero artwork, featured cards, lyrics), `xl 28` (sheets and dialogs), `pill` (buttons, chips, play).
- **Elevation:** dark theme separates by surface steps; light theme adds `Elevation.card` (soft 4/12 shadow) to cards. `Elevation.art` sits under hero artwork; `Elevation.floating` under the big play button. No blur anywhere: gradients do the work and cost less on Android.
- **Repeated elements share edges and baselines:** one song row, one sheet row, one section header.

## 6. Motion

Motion is authored by hand on Reanimated primitives (`withTiming`, `withSequence`, `interpolate`) with our own curves. **No canned presets** (`FadeIn*`, `SlideIn*`, Moti, Lottie). If it moves, someone designed how.

### Tokens (`Motion` in theme.ts)
| Token | Value | For |
|---|---|---|
| `instant` | 90ms | Press-in |
| `quick` | 140ms | Exits, small fades |
| `base` | 200ms | State changes, toggles, chips |
| `glide` | 280ms | Entrances, travel |
| `slow` | 360ms | Hero transitions, tint crossfades |
| `celebrate` | 900ms | Milestones only |
| `glide` curve | (.65,0,.35,1) | Movement from A to B |
| `out` curve | (.16,1,.3,1) | Arrivals |
| `in` curve | (.7,0,.84,0) | Departures |
| `standard` | (.2,0,0,1) | Colour and opacity |

### The 12 principles, as RagaStream uses them
| Principle | Where |
|---|---|
| Squash & stretch | Like heart pops tall then settles; logo dot lands; tab indicator stretches in flight |
| Anticipation | Like and buttons compress on press-in before acting |
| Staging | Entrances stagger 40ms (max 6 items) so the eye is led, never flooded |
| Pose to pose | Every animation is start → end (with an overshoot pose where it helps) |
| Follow-through | Presses release to 1.02 then settle; mini player leans in when it catches a song |
| Slow in / slow out | No linear motion except loading spinners |
| Arcs | Glide flights travel a Bézier arc; skipped artwork tilts as it leaves |
| Secondary action | Glide strokes burst from the heart; Kesar pours into checks and toggles |
| Timing | Interactions ≤ 300ms; one scale reused everywhere |
| Exaggeration | Reserved for Riyaz milestone celebrations |
| Solid drawing | Artwork casts a real shadow; the art breathes back when paused |
| Appeal | Everything above, applied consistently |

### Vocabulary (reuse these; don't invent one-offs)
| Name | What it does | Where (file) |
|---|---|---|
| **Press** | Compress to 0.96 (rows 0.985), release with a 2% overshoot | `motion/primitives.ts` → `usePressMotion`, `ui/Tappable` |
| **Rise** | Enter from 14pt below on `out`, staggered; first mount only | `motion/Rise.tsx` |
| **Glide flight** | Queued song's art flies on an arc into the mini player, which bumps to catch it | `motion/flight.tsx` |
| **Inchworm** | Selection indicators travel leading edge first, trailing edge catches up | `TabBar.tsx`, `ui/Segmented.tsx` |
| **Pour** | Selection colour floods in (chips, checks, toggles, focused fields) | `ui/Chip`, `ui/CheckMark`, `ui/Toggle`, `ui/TextField` |
| **Morph** | Play ⇄ pause reshape as one glyph | `motion/PlayPauseIcon.tsx` |
| **Breath** | Now Playing art eases to 93% when paused, back on play | `NowPlayingScreen.tsx` |
| **Draw** | The Meend stroke draws itself | `Logo.tsx` |
| **Celebrate** | Mark draws, dot lands, glide strokes burst, words rise | `MilestoneHost.tsx` |
| **Breathing skeleton** | Loading highlight glides across, rests, repeats | `SkeletonLoader.tsx` |

**Loops** are allowed only for loading (skeletons, spinners) and "now playing" signals (equalizer bars, a long title's marquee). Never decoration.

**Reduce motion:** every primitive checks `useReducedMotion()` and swaps movement for a short fade or an instant change.

## 7. Components

| Component | File | Notes |
|---|---|---|
| Text | `ui/Text.tsx` | The only text primitive; roles from §4 |
| Button | `ui/Button.tsx` | `primary` (Kesar, one per screen), `secondary`, `outline`, `ghost`, `danger`; sm 36 / md 44 / lg 52 |
| IconButton | `ui/IconButton.tsx` | 44pt target, `plain` / `tonal` / `accent` |
| Chip | `ui/Chip.tsx` | Filters; selected = Kesar fill with ink text |
| Tappable | `ui/Tappable.tsx` | Cards, tiles, rows |
| TextField | `ui/TextField.tsx` | Label above, icon inside, Kesar focus border, inline error |
| Toggle / Segmented / CheckMark | `ui/` | Hand-built controls (no native Switch) |
| SheetRow / SheetHeader | `ui/SheetRow.tsx` | Every bottom-sheet row |
| SectionHeader / EmptyState / Screen | `ui/` | Section titles, designed empty states, screen root |
| Toast | `ui/Toast.tsx` + `services/toast.ts` | Inverse pill above the mini player |
| AppModal | `AppModal.tsx` | `showModal` / `confirmModal`; replaces native Alert |
| SongRow | `SongRow.tsx` | The one song row (menu, swipe-to-queue, swipe-to-remove) |
| MiniPlayer / TabBar | `MiniPlayer.tsx`, `TabBar.tsx` | Artwork-tinted player above a fading tab bar |
| CollapsingHeader | `CollapsingHeader.tsx` | Hero → top bar, pinned play button |
| SeekBar | `SeekBar.tsx` | Gesture-built scrubber with time bubble |
| Sheets | `QueueSheet`, `SaveToSheet`, `SongOptionsSheet`, `SleepTimer`, `SpeedSheet` | On `AnimatedBottomSheet` |
| PlaylistCover | `PlaylistCover.tsx` | 2×2 mosaic at 4+ songs; Liked = Kesar → Neel tile |

## 8. Screens (one primary job each)

| Screen | Primary action | Signature moment |
|---|---|---|
| Splash | — | Stroke draws, wordmark rises, lifts away |
| Sign in / Sign up | Continue with Google / Sign in | Giant faint Meend draws behind the form |
| Home | Tap a Jump back in tile | Prahar wash + raga-of-the-hour greeting |
| Search | Tap a result | Mood tiles with oversized cropped glyphs |
| Library | Open a playlist | Pins in Kesar; list ⇄ grid |
| Playlist / Liked / Channel | Big Kesar play | Hero collapses into the bar; play button pins |
| Now Playing | Play / pause | Breath, morph, swipe-to-skip with tilt |
| Stats | Switch range | Channel bars fill on arrival |
| Settings | Toggle a setting | Segmented theme switch with inchworm pill |
| Milestone | Keep going | The one exaggerated celebration |

## 9. Accessibility

- AA contrast in both themes (§3). Every gesture has a visible button equivalent (swipe-to-skip ↔ skip buttons; swipe-to-queue ↔ menu).
- Icon-only controls carry `accessibilityLabel`; toggles and chips expose `selected` / `checked` state.
- System font scale respected (capped 1.35×); reduce-motion respected everywhere.
- Errors appear next to the field that needs fixing and say how to fix it.

## 10. Voice

Plain, warm, specific. Name things the way listeners do ("Liked Songs", "Up next", "Go to song radio"). Buttons say what happens ("Create", "Save", "Keep going"). Errors explain and offer the fix ("Couldn't start playback. Check your connection and try again."). Never blame the user, never apologise with filler.
