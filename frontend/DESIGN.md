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

Default to flat, high-contrast surfaces for dense, text-heavy, or list-based screens (Search results, Playlist tracks, Settings) so legibility never competes with the aesthetic. Reserve glass/blur treatment for overlay surfaces only — Mini Player, Now Playing background, bottom sheets, modals, and the bottom navigation bar — where layering communicates "this floats above the content."

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

## Geometry & Shape

- **sm (8px)**: small elements — chips, badges, input field corners.
- **md (16px)**: the default card radius — search result thumbnails, Quick Picks cards, bottom sheet top corners.
- **lg (20px)**: hero/featured elements — Featured Today banners, Now Playing album art, the Liked Songs hero card.
- **full (999px)**: fully rounded — primary circular Play/Pause button, avatar images, pill-shaped genre chips and filter buttons.

Corners throughout are generous and soft — never sharp 0px corners, even on dense list rows (use at minimum `sm` on thumbnails) — reinforcing the "soft, tactile, premium" feel over a clinical/utilitarian one.

## Depth & Elevation

Two distinct elevation languages coexist intentionally:

1. **Flat elevation** (list rows, Settings rows, Search results): a barely-there `card-shadow` (`0 4px 16px rgba(0,0,0,0.4)`) on the #121414 surface against the #000000 base — just enough separation to imply a card without distracting from text density.
2. **Glass elevation** (Mini Player, Now Playing scrim, bottom sheets, bottom nav bar): `overlay-blur` of 24px backdrop blur, a 1px translucent white border (~10% opacity) along the top edge, and a soft shadow beneath. This communicates "floating above," and should only be used where content is genuinely layered on top of other content — never as a decorative skin on a flat screen.

On the Now Playing screen specifically, the background is the current track's thumbnail, heavily blurred (40px+) and darkened (60-70% black scrim) to derive an ambient color wash — the glass panels for controls then sit on top of *that*, creating two layers of depth rather than one.

## Components

- **Buttons**:
  - *Primary*: solid #7C3AED fill, white text, `full` or `md` radius depending on context (circular for play controls, pill for "Sign In" / "Create Playlist").
  - *Secondary*: dark #121414 fill with white text, used for less-emphasized actions sitting next to a primary button (e.g. "Secondary" tab in the palette panel).
  - *Inverted*: white/light fill with dark text — reserved almost exclusively for the Google OAuth button per Google's branding guidelines, and any other "external system" action that shouldn't visually compete with RagaStream's own purple identity.
  - *Outlined*: transparent fill, 1px border, used for tertiary/low-emphasis actions.
- **Chips**: pill-shaped (`full` radius), used for genre shortcuts on Home/Search. Active/selected state fills solid purple; inactive state is a muted dark surface with light text.
- **Search bar**: `md` radius, #121414 fill, leading search icon at reduced opacity, trailing clear icon appears once text is entered.
- **Bottom navigation**: glass-elevation bar fixed to the screen bottom, icons-with-labels, active tab icon and label rendered in primary purple, inactive in muted white.
- **Action icon buttons** (the small circular icon row seen in the component panel — wand/sparkle, share, tag, delete): circular, `full` radius, each carries its own semantic accent color when it represents a destructive or highlighted action (e.g. red-tinted circular background for delete), otherwise neutral dark-surface circular buttons with a white icon.
- **Badges**: small `sm`-radius label-caps text badges — most notably the red "YouTube" source badge that appears bottom-right on any thumbnail sourced from YouTube, signaling provenance without distracting from the artwork.

## Motion & Interaction (descriptive, not literal token values)

- Tappable cards and rows get a subtle scale-down press state (about 96-98% scale) rather than a color change, keeping the dark palette calm.
- The Liked heart fills from outline to solid gold with a brief scale "pop" on tap.
- The Mini Player slides up from off-screen the first time a track loads, and persists with a quiet top-edge progress line indicating playback position.
- Bottom sheets (Queue, Add to Playlist, Sleep Timer) slide up with a drag handle, dismissible by swipe-down, consistent with native Android gesture conventions.

## Platform Notes

- Designed for native Android conventions: respect system status bar insets, avoid placing primary actions in the bottom gesture-nav exclusion zone, and keep primary tap targets in the lower two-thirds of the screen for thumb reach.
- Dark theme is the *only* theme — there is no light mode variant; OLED true-black is a deliberate product choice (battery efficiency + late-night listening context), not a default to be inverted later.
