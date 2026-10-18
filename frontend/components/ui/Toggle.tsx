import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Motion, Radius } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import { tapHaptic } from '../../services/haptics';

const W = 50;
const H = 30;
const KNOB = 24;

/**
 * Switch drawn by hand: the knob glides across (slow-in/slow-out) and widens
 * briefly mid-travel, while Kesar pours into the track.
 */
export default function Toggle({ value, onChange, accessibilityLabel }: { value: boolean; onChange: (v: boolean) => void; accessibilityLabel: string }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const on = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(value ? 1 : 0, { duration: reduced ? 1 : Motion.duration.glide, easing: Motion.easing.glide });
  }, [on, reduced, value]);

  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.value, [0, 1], [colors.surfacePressed, colors.accent]) }));
  const knob = useAnimatedStyle(() => {
    const stretch = Math.sin(on.value * Math.PI) * 6; // widest mid-travel
    return {
      width: KNOB + stretch,
      transform: [{ translateX: 3 + on.value * (W - KNOB - 6) - stretch * on.value }],
    };
  });

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onChange(!value);
      }}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
    >
      <Animated.View style={[{ borderRadius: Radius.pill, height: H, justifyContent: 'center', width: W }, track]}>
        <Animated.View style={[{ backgroundColor: '#FFFFFF', borderRadius: Radius.pill, height: KNOB, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }, knob]} />
      </Animated.View>
    </Pressable>
  );
}
