import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Motion, Radius } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';

/**
 * Round check used in selection lists. Checking pours Kesar in and pops the
 * tick (0.6 → 1.12 → 1); unchecking drains it quietly.
 */
export default function CheckMark({ checked, size = 24 }: { checked: boolean; size?: number }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const fill = useSharedValue(checked ? 1 : 0);
  const tick = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    fill.value = withTiming(checked ? 1 : 0, { duration: Motion.duration.quick, easing: Motion.easing.standard });
    if (checked && !reduced) {
      tick.value = withSequence(
        withTiming(1.12, { duration: 160, easing: Motion.easing.out }),
        withTiming(1, { duration: 120, easing: Motion.easing.standard })
      );
    } else {
      tick.value = withTiming(checked ? 1 : 0, { duration: Motion.duration.quick, easing: Motion.easing.in });
    }
  }, [checked, fill, reduced, tick]);

  const ringStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(fill.value, [0, 1], ['transparent', colors.accent]),
    borderColor: interpolateColor(fill.value, [0, 1], [colors.textTertiary, colors.accent]),
  }));
  const tickStyle = useAnimatedStyle(() => ({ opacity: Math.min(tick.value, 1), transform: [{ scale: tick.value }] }));

  return (
    <Animated.View
      style={[{ alignItems: 'center', borderRadius: Radius.pill, borderWidth: 2, height: size, justifyContent: 'center', width: size }, ringStyle]}
    >
      <Animated.View style={tickStyle}>
        <View>
          <Ionicons name="checkmark" size={size * 0.62} color={colors.onAccent} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}
