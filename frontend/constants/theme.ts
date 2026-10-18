/**
 * RagaStream · Meend design tokens.
 *
 * Meend (मींड) is the glide between two notes. The system is built from that
 * idea: one continuous line, Kesar (saffron) for every action, Neel (indigo)
 * for signals, on Ink at night and Porcelain by day.
 *
 * Every colour, size, radius and duration in the app comes from this file.
 * DESIGN.md documents the reasoning; keep the two in sync.
 */
import { Easing } from 'react-native-reanimated';

// ── Brand palette (raw values — use semantic colours below in UI) ─────────────
export const Brand = {
  kesar: '#FF7A1A',
  kesarDeep: '#B54A08',
  kesarLight: '#FF9A4D',
  neel: '#6E8BFF',
  neelDeep: '#3F5BE0',
  neelLight: '#8FA5FF',
  ink: '#0B0F1A',
  porcelain: '#F5F6FA',
} as const;

export type ThemeColors = {
  bg: string;            // screen background
  surface: string;       // cards, sheets, mini player base
  surfaceRaised: string; // rows on cards, inputs, chips at rest
  surfacePressed: string;
  border: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;        // Kesar fill: the one primary action per screen
  accentPressed: string;
  onAccent: string;      // text/icons on an accent fill
  accentInk: string;     // Kesar as text/icon on bg (contrast-checked)
  accentSoft: string;    // tinted background for selected / active states
  signal: string;        // Neel: secondary signals (now playing, info, links)
  signalSoft: string;
  success: string;
  warning: string;
  danger: string;
  dangerSoft: string;
  scrim: string;
  skeleton: string;
  skeletonHighlight: string;
  fadeTop: string;       // gradient stops for bars that fade into content
  fadeBottom: string;
};

export const darkColors: ThemeColors = {
  bg: '#0B0F1A',
  surface: '#121828',
  surfaceRaised: '#1A2133',
  surfacePressed: '#232C42',
  border: 'rgba(163,172,194,0.14)',
  text: '#EEF1F8',
  textSecondary: '#A3ACC2',
  textTertiary: '#7A84A0',
  accent: Brand.kesar,
  accentPressed: '#EA6A0E',
  onAccent: '#1A0B00',
  accentInk: '#FF8F3D',
  accentSoft: 'rgba(255,122,26,0.14)',
  signal: Brand.neelLight,
  signalSoft: 'rgba(110,139,255,0.16)',
  success: '#3DD68C',
  warning: '#FFC24D',
  danger: '#FF5D6C',
  dangerSoft: 'rgba(255,93,108,0.14)',
  scrim: 'rgba(5,7,13,0.62)',
  skeleton: '#161D2E',
  skeletonHighlight: '#222B40',
  fadeTop: 'rgba(11,15,26,0)',
  fadeBottom: 'rgba(11,15,26,0.96)',
};

export const lightColors: ThemeColors = {
  bg: '#F5F6FA',
  surface: '#FFFFFF',
  surfaceRaised: '#EDEFF5',
  surfacePressed: '#E2E6EF',
  border: 'rgba(11,15,26,0.08)',
  text: '#0B0F1A',
  textSecondary: '#4A5268',
  textTertiary: '#687089',
  accent: Brand.kesar,
  accentPressed: '#EA6A0E',
  onAccent: '#1A0B00',
  accentInk: Brand.kesarDeep,
  accentSoft: 'rgba(255,122,26,0.12)',
  signal: Brand.neelDeep,
  signalSoft: 'rgba(63,91,224,0.10)',
  success: '#12925A',
  warning: '#9A5B00',
  danger: '#C62839',
  dangerSoft: 'rgba(217,45,67,0.10)',
  scrim: 'rgba(11,15,26,0.45)',
  skeleton: '#E6E9F1',
  skeletonHighlight: '#F2F4F8',
  fadeTop: 'rgba(245,246,250,0)',
  fadeBottom: 'rgba(245,246,250,0.97)',
};

// ── Typography ───────────────────────────────────────────────────────────────
// Bricolage Grotesque speaks (display, titles); Geist does the work (UI, lists);
// Geist Mono keeps time and numbers steady.
export const Fonts = {
  display: 'BricolageGrotesque_800ExtraBold',
  displayBold: 'BricolageGrotesque_700Bold',
  displaySemi: 'BricolageGrotesque_600SemiBold',
  body: 'Geist_400Regular',
  bodyMedium: 'Geist_500Medium',
  bodySemi: 'Geist_600SemiBold',
  bodyBold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
} as const;

export type TextVariant =
  | 'hero'
  | 'display'
  | 'headline'
  | 'title'
  | 'subtitle'
  | 'body'
  | 'bodyStrong'
  | 'caption'
  | 'captionStrong'
  | 'label'
  | 'mono';

type TypeStyle = { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number; textTransform?: 'uppercase' };

export const Type: Record<TextVariant, TypeStyle> = {
  hero: { fontFamily: Fonts.display, fontSize: 44, lineHeight: 46, letterSpacing: -1.4 },
  display: { fontFamily: Fonts.display, fontSize: 32, lineHeight: 36, letterSpacing: -0.9 },
  headline: { fontFamily: Fonts.displayBold, fontSize: 24, lineHeight: 28, letterSpacing: -0.5 },
  title: { fontFamily: Fonts.displayBold, fontSize: 19, lineHeight: 24, letterSpacing: -0.3 },
  subtitle: { fontFamily: Fonts.bodySemi, fontSize: 16, lineHeight: 21, letterSpacing: -0.1 },
  body: { fontFamily: Fonts.body, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: Fonts.bodyMedium, fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 18 },
  captionStrong: { fontFamily: Fonts.bodySemi, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: Fonts.bodySemi, fontSize: 11, lineHeight: 14, letterSpacing: 0.9, textTransform: 'uppercase' },
  mono: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
};

// ── Space, shape, elevation ──────────────────────────────────────────────────
/** 4pt grid. `Space[4]` = 16. Screens use `Layout.gutter` on both sides. */
export const Space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const Layout = {
  gutter: 20,
  tabBarHeight: 64,
  miniPlayerHeight: 64,
  touchTarget: 44,
  rowHeight: 64,
  thumb: 48,
} as const;

export const Radius = {
  xs: 6,
  sm: 10,   // thumbnails, inputs
  md: 14,   // cards, mini player
  lg: 20,   // hero artwork, featured cards
  xl: 28,   // bottom sheets
  pill: 999,
} as const;

export const Elevation = {
  // Dark theme separates by surface steps; light theme adds a soft shadow.
  card: { shadowColor: '#0B0F1A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  floating: { shadowColor: '#0B0F1A', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 10 },
  art: { shadowColor: '#000000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.35, shadowRadius: 30, elevation: 14 },
} as const;

// ── Motion ───────────────────────────────────────────────────────────────────
/**
 * Meend motion: things glide on curves; arrivals ease out, departures ease in.
 * Interactions stay under 300ms. `celebrate` is reserved for milestones.
 */
export const Motion = {
  duration: {
    instant: 90,
    quick: 140,
    base: 200,
    glide: 280,
    slow: 360,
    celebrate: 900,
  },
  easing: {
    /** Movement from A to B (sheets, flights, indicators): slow-in, slow-out. */
    glide: Easing.bezier(0.65, 0, 0.35, 1),
    /** Arrivals: fast start, long settle. */
    out: Easing.bezier(0.16, 1, 0.3, 1),
    /** Departures: gather, then go. */
    in: Easing.bezier(0.7, 0, 0.84, 0),
    /** Small state changes (colour, opacity). */
    standard: Easing.bezier(0.2, 0, 0, 1),
  },
  /** Delay between list items entering. Capped so long lists don't feel slow. */
  stagger: 40,
  staggerMax: 6,
  pressScale: 0.96,
  /** Distance content rises when it enters. */
  rise: 14,
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────
function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Mix two hex colours. `amount` 0 → a, 1 → b. */
export function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const ch = (p: number, q: number) => Math.round(p + (q - p) * amount).toString(16).padStart(2, '0');
  return `#${ch(x.r, y.r)}${ch(x.g, y.g)}${ch(x.b, y.b)}`;
}

/** Hex colour with alpha, e.g. alpha('#FF7A1A', 0.2). */
export function alpha(hex: string, value: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${value})`;
}
