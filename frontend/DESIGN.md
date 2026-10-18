---
name: RagaStream
colors:
  primary: "#7C3AED"
  secondary: "#F5A623"
  tertiary: "#121414"
  neutral: "#FFFFFF"
  base: "#000000"
typography:
  h1:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: 700
  h2:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: 700
  body-md:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 400
  body-sm:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: 400
  label-caps:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: 600
rounded:
  sm: 8px
  md: 16px
  lg: 20px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
elevation:
  overlay-blur: 24px
  card-shadow: "0 4px 16px rgba(0,0,0,0.4)"
---

## Overview

RagaStream is built for **late-night, headphones-on listening** — the visual language should feel like a premium, ad-free private listening room, not a generic music app template. The mood is **moody, confident, and warm**: an OLED-true-black canvas (#000000) punctuated by Deep Purple (#7C3AED) for action and a Warm Gold (#F5A623) for emotional/personal moments (liked songs, favorites, highlights). Where most music apps go flat-and-cold dark mode, RagaStream should feel a degree warmer and more tactile — closer to a velvet listening lounge than a spreadsheet in dark mode.

Default to flat, high-contrast surfaces for dense, text-heavy, or list-based screens (Search results, Playlist tracks, Settings) so legibility never competes with the aesthetic. Depth on playback surfaces comes from **artwork colour**, not blur: the Mini Player, Now Playing and playlist/channel heroes are tinted with a palette derived from the current artwork, so every song and playlist feels distinct while purple stays the action colour.

## Colors

- **Primary — Deep Purple (#7C3AED)**: the app's core action color. Used for primary CTAs (Play buttons, "Create Playlist," "Sign In"), active tab/nav states, the active seek-bar fill, and selection states (selected chips, selected queue item glow).
- **Secondary — Warm Gold (#F5A623)**: reserved for emotional/personal signals — the filled "Liked" heart, "Featured Today" badges, active shuffle/repeat icon states, and any "your taste" personalization markers. Used sparingly; gold should always read as a highlight, never a base color.
- **Tertiary — Near-Black Surface (#121414)**: the primary surface color for cards, sheets, input fields, and the bottom tab bar's base layer (before blur is applied). Sits one step lighter than the true-black base so cards have gentle separation without a hard border.
- **Base — True Black (#000000)**: the root background of every screen. OLED-optimized; the deepest layer behind all content.
- **Neutral — White (#FFFFFF)**: primary text color on dark surfaces, and the inverted background for high-emphasis light elements (e.g. the "Sign in with Google" button, which intentionally breaks the dark palette per Google's own branding requirements).
- **Muted text**: not a defined token above, but in implementation use white at reduced opacity (70% for secondary text like channel names/timestamps, 45% for placeholder/disabled text) rather than introducing a new gray token — this keeps the palette minimal and avoids "muddy gray" surfaces fighting the true-black base.

## Typography

Inter throughout — a clean, geometric sans that stays legible at small sizes (track metadata, durations) while still feeling premium at large display sizes (song titles, greeting headers).

- **h1 (2rem / 700)**: screen-level headers — "Good evening, Anything," Now Playing song title, playlist hero titles.
- **h2 (1.5rem / 700)**: section headers — "Quick Picks," "Recently Played," "Featured Today."
- **body-md (1rem / 400)**: primary content text — song titles in list rows, playlist descriptions.
- **body-sm (0.875rem / 400)**: secondary/metadata text — channel names, durations, timestamps.
- **label-caps (0.75rem / 600)**: small uppercase-style labels — chip text, button labels, badge text ("YOUTUBE" source badge).

In code, `TypeScale` in `constants/theme.ts` adds the in-between steps dense UI needs: **11** (captions, timestamps), **13** (secondary text in list rows — keeps lists tidy), **16**, **18**, **20** (sheet titles, small section headers), **24**, **32**. `Spacing` likewise adds 2/6/12/20/64 to the 4/8/16/24/32 base.

## Geometry & Shape

- **sm (8px)**: small elements — chips, badges, input field corners.
- **md (16px)**: the default card radius — search result thumbnails, Quick Picks cards, bottom sheet top corners.
- **lg (20px)**: hero/featured elements — Featured Today banners, Now Playing album art, the Liked Songs hero card.
- **full (999px)**: fully rounded — primary circular Play/Pause button, avatar images, pill-shaped genre chips and filter buttons.

Corners throughout are generous and soft — never sharp 0px corners, even on dense list rows (use at minimum `sm` on thumbnails) — reinforcing the "soft, tactile, premium" feel over a clinical/utilitarian one.

## Depth & Elevation

Three elevation languages coexist intentionally:

1. **Flat elevation** (list rows, Settings rows, Search results): a barely-there `card-shadow` (`0 4px 16px rgba(0,0,0,0.4)`) on the #121414 surface against the #000000 base — just enough separation to imply a card without distracting from text density.
2. **Tinted elevation** (Mini Player, Now Playing, playlist / Liked Songs / channel heroes): the backend derives a palette from the artwork (`GET /artwork/color` → `accent`, `background`, `muted`; `useArtworkColor()` in code). Heroes and Now Playing use a vertical gradient from `background` into true black; the Mini Player is a solid `background` tint; collapsed top bars use `muted`. Tints crossfade (300ms) when the track changes. Gradients replace blur here — they read the same, cost far less on Android, and carry the song's own colour.
3. **Glass elevation** (bottom sheets, modals): reserved for surfaces genuinely layered over other content. The bottom navigation is a transparent-to-black **gradient fade** so content scrolls softly beneath it rather than ending at a hard edge.

## Components

- **Buttons**:
  - *Primary*: solid #7C3AED fill, white text, `full` or `md` radius depending on context (circular for play controls, pill for "Sign In" / "Create Playlist").
  - *Secondary*: dark #121414 fill with white text, used for less-emphasized actions sitting next to a primary button (e.g. "Secondary" tab in the palette panel).
  - *Inverted*: white/light fill with dark text — reserved almost exclusively for the Google OAuth button per Google's branding guidelines, and any other "external system" action that shouldn't visually compete with RagaStream's own purple identity.
  - *Outlined*: transparent fill, 1px border, used for tertiary/low-emphasis actions.
- **Chips**: pill-shaped (`full` radius), used for genre shortcuts on Home/Search. Active/selected state fills solid purple; inactive state is a muted dark surface with light text.
- **Search bar**: `md` radius, #121414 fill, leading search icon at reduced opacity, trailing clear icon appears once text is entered.
- **Bottom navigation**: gradient-fade bar fixed to the screen bottom, icons-with-labels, active tab icon and label rendered in primary purple, inactive in muted white. The Mini Player floats directly above it.
- **Mini Player**: artwork-tinted card above the tab bar — thumbnail, title/channel, like, play/pause, next; a 2px white progress line along the bottom edge. Swipe left/right to skip; tap to open Now Playing.
- **Now Playing**: a scrolling page. Above the fold: artwork (swipe to skip), title + like, seek bar, transport row with shuffle and repeat flanking it (active = gold with a dot), and a utility row (sleep timer, speed, save, share, queue). Below the fold: lyrics card (artwork `accent` fill), Up next, About the channel.
- **Collapsing header** (playlist, Liked Songs, channel): tinted hero with large title; on scroll the top bar fades to `muted` and shows the title, and the circular purple play button pins beneath it.
- **Song rows**: 48px thumbnail, title (purple + equalizer when playing), 13px secondary line, ⋮ menu. Long-press opens the song menu; swipe right adds to queue; swipe left removes (where removal applies).
- **Action icon buttons** (the small circular icon row seen in the component panel — wand/sparkle, share, tag, delete): circular, `full` radius, each carries its own semantic accent color when it represents a destructive or highlighted action (e.g. red-tinted circular background for delete), otherwise neutral dark-surface circular buttons with a white icon.
- **Badges**: small `sm`-radius label-caps text badges — most notably the red "YouTube" source badge that appears bottom-right on any thumbnail sourced from YouTube, signaling provenance without distracting from the artwork.

## Motion & Interaction

Tokens live in `Motion` (`constants/theme.ts`):

- **Durations**: 50 / 100 / 150 / 200 / 250 / 300ms. Nothing user-facing exceeds 300ms.
- **Easing**: one family — standard `cubic-bezier(.3, 0, 0, 1)`; elements *enter* with decelerate (250–300ms) and *exit* with accelerate (200ms). Prefer timing curves over springs.
- **No decorative loops.** Infinite animations are reserved for loading (skeletons, spinners) and "now playing" indicators (equalizer bars, long-title marquee). Artwork never spins or pulses.

Behaviours:

- Tappable cards and rows scale to 97% on press (`Motion.pressScale`) rather than changing colour.
- The Liked heart fills from outline to solid gold with a brief scale "pop" on tap.
- The Mini Player slides up the first time a track loads; its tint crossfades between tracks.
- Bottom sheets (Queue, Save to, Sleep Timer, Speed) slide up with a drag handle, dismissible by swipe-down.
- Light haptics on transport controls, chips and tab changes; a firmer tick on committed gestures (swipe-to-skip, swipe-to-queue, drag start); a success pattern on saves.

## Platform Notes

- Designed for native Android conventions: respect system status bar insets, avoid placing primary actions in the bottom gesture-nav exclusion zone, and keep primary tap targets in the lower two-thirds of the screen for thumb reach.
- Dark theme is the *only* theme — there is no light mode variant; OLED true-black is a deliberate product choice (battery efficiency + late-night listening context), not a default to be inverted later.
