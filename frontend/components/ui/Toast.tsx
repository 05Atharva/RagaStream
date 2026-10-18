import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Layout, Motion, Radius, Space } from '../../constants/theme';
import { useColors, useTheme } from '../../theme/ThemeProvider';
import { usePlayerStore } from '../../store/playerStore';
import Text from './Text';

import Toast, { useToastStore, type ToastMessage, type ToastType } from '../../services/toast';

const VISIBLE_MS = 2600;
const ICONS: Record<ToastType, React.ComponentProps<typeof Ionicons>['name']> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

/**
 * Inverse pill that rises from just above the mini player on the `out` curve
 * with a 2pt overshoot, holds, then drops away on `in`. A new toast replaces
 * the current one in place (no stacking).
 */
export function ToastHost() {
  const colors = useColors();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const current = useToastStore((s) => s.current);
  const hasMiniPlayer = usePlayerStore((s) => s.currentTrack !== null);
  const [shown, setShown] = useState<ToastMessage | null>(null);
  const y = useSharedValue(40);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!current) {
      opacity.value = withTiming(0, { duration: Motion.duration.quick, easing: Motion.easing.in });
      return;
    }
    setShown(current);
    y.value = reduced ? 0 : 24;
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: Motion.duration.base, easing: Motion.easing.standard });
    y.value = reduced
      ? 0
      : withSequence(
          withTiming(-2, { duration: Motion.duration.glide, easing: Motion.easing.out }),
          withTiming(0, { duration: Motion.duration.quick, easing: Motion.easing.standard })
        );
    const timer = setTimeout(() => {
      y.value = withTiming(reduced ? 0 : 16, { duration: Motion.duration.base, easing: Motion.easing.in });
      opacity.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.in }, (done) => {
        if (done) runOnJS(clearIfCurrent)(current.id);
      });
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, opacity, reduced, y]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));

  if (!shown) return null;

  const bottom =
    insets.bottom + Layout.tabBarHeight + (hasMiniPlayer ? Layout.miniPlayerHeight : 0) + Space[3];
  const iconColor =
    shown.type === 'error' ? colors.danger : shown.type === 'success' ? (isDark ? '#E8620A' : '#FF8F3D') : isDark ? '#3F5BE0' : '#8FA5FF';

  return (
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', left: Layout.gutter, right: Layout.gutter, bottom }, style]}>
      <Pressable
        onPress={Toast.hide}
        accessibilityRole="alert"
        style={{
          alignItems: 'center',
          backgroundColor: colors.text,
          borderRadius: Radius.md,
          flexDirection: 'row',
          gap: Space[3],
          paddingHorizontal: Space[4],
          paddingVertical: Space[3],
        }}
      >
        <Ionicons name={ICONS[shown.type]} size={20} color={iconColor} />
        <View style={{ flex: 1 }}>
          <Text variant="captionStrong" color={colors.bg}>{shown.text1}</Text>
          {shown.text2 ? <Text variant="caption" color={colors.bg} style={{ opacity: 0.75 }}>{shown.text2}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function clearIfCurrent(id: number) {
  if (useToastStore.getState().current?.id === id) useToastStore.setState({ current: null });
}
