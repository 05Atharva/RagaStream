/**
 * SafeBlurView.tsx
 *
 * Wraps @react-native-community/blur with a NativeModules guard.
 * In Expo Go the native BlurView is unavailable — we render a
 * semi-transparent dark overlay instead (visually close enough).
 * In native builds (EAS / expo run:android) the real blur renders.
 */
import React from 'react';
import { NativeModules, StyleSheet, View, type ViewStyle } from 'react-native';

type BlurType = 'dark' | 'light' | 'xlight' | 'regular' | 'prominent';

type Props = {
  blurAmount?: number;
  blurType?: BlurType;
  reducedTransparencyFallbackColor?: string;
  style?: ViewStyle | ViewStyle[];
};

// @react-native-community/blur registers "BlurView" or "RNSkiaAndroidBlurView"
const _nm = NativeModules as Record<string, unknown>;
const isBlurAvailable =
  Boolean(_nm.BlurView) ||
  Boolean(_nm.RNBlur) ||
  Boolean(_nm.AndroidBlurView) ||
  Boolean(_nm.RNCBlur);

let NativeBlurView: React.ComponentType<Props> | null = null;
if (isBlurAvailable) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    NativeBlurView = (require('@react-native-community/blur') as { BlurView: React.ComponentType<Props> }).BlurView;
  } catch {
    NativeBlurView = null;
  }
}

export default function SafeBlurView({
  blurAmount = 32,
  blurType = 'dark',
  reducedTransparencyFallbackColor,
  style,
}: Props) {
  if (NativeBlurView) {
    return (
      <NativeBlurView
        blurAmount={blurAmount}
        blurType={blurType}
        reducedTransparencyFallbackColor={reducedTransparencyFallbackColor}
        style={style}
      />
    );
  }

  // Expo Go fallback — a dark translucent overlay mimics the blur
  const alpha = blurType === 'dark' ? 0.75 : 0.55;
  return (
    <View
      style={[
        style,
        StyleSheet.absoluteFillObject,
        { backgroundColor: `rgba(0,0,0,${alpha})` },
      ]}
    />
  );
}
