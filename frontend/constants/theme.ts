// Theme constants for RagaStream dark theme — values mirror DESIGN.md.
import { Easing } from 'react-native-reanimated';

export const Colors = {
  background: '#000000',
  surface: '#121414',
  surfaceHighlight: '#1C1E1E',
  surfaceElevated: '#262828',
  primary: '#7C3AED',
  primaryLight: '#9B62F5',
  secondary: '#F5A623',
  onBackground: '#FFFFFF',
  onSurface: '#E0E0E0',
  onPrimary: '#FFFFFF',
  textSubdued: 'rgba(255,255,255,0.7)',
  textMuted: 'rgba(255,255,255,0.45)',
  muted: '#888888',
  border: 'rgba(255,255,255,0.08)',
  // Semantic colours — use these instead of one-off hex values.
  error: '#ED2C3F',
  warning: '#F5A623',
  success: '#22C55E',
  info: '#539DF5',
} as const;

export const Typography = {
  fontSizeXs: 11,
  fontSizeSm: 13,
  fontSizeMd: 16,
  fontSizeLg: 20,
  fontSizeXl: 24,
  fontSizeXxl: 32,
  fontWeightRegular: '400' as const,
  fontWeightMedium: '500' as const,
  fontWeightSemiBold: '600' as const,
  fontWeightBold: '700' as const,
};

// Finer type scale (11/13/16/18/20/24/32) — 13px secondary text keeps dense
// lists tidy; 18/20 fill the gap between body and section headers.
export const TypeScale = {
  caption: 11,
  small: 13,
  body: 16,
  large: 18,
  title: 20,
  heading: 24,
  display: 32,
} as const;

export const Spacing = {
  xxs: 2,
  xs: 4,
  s: 6,
  sm: 8,
  ms: 12,
  md: 16,
  ml: 20,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

export const BorderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

// Motion: short, consistent, one easing family. Enter decelerates (250ms),
// exit accelerates (200ms). Looping animations are reserved for loading and
// "now playing" indicators — never decoration.
export const Motion = {
  duration: {
    instant: 50,
    fast: 100,
    quick: 150,
    base: 200,
    enter: 250,
    slow: 300,
  },
  easing: {
    standard: Easing.bezier(0.3, 0, 0, 1),
    decelerate: Easing.bezier(0, 0, 0.2, 1),
    accelerate: Easing.bezier(0.8, 0, 1, 1),
  },
  pressScale: 0.97,
} as const;
