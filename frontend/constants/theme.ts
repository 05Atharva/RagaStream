// Theme constants for RagaStream dark theme
export const Colors = {
  background: '#121212',
  surface: '#1E1E1E',
  primary: '#7C3AED',
  primaryLight: '#9B62F5',
  onBackground: '#FFFFFF',
  onSurface: '#E0E0E0',
  onPrimary: '#FFFFFF',
  muted: '#888888',
  border: '#2C2C2C',
  error: '#CF6679',
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

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const BorderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};
