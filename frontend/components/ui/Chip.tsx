import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Motion, Radius, Space, Type } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import { usePressMotion } from '../../motion/primitives';
import { tapHaptic } from '../../services/haptics';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
};

/**
 * Filter chip. Selection pours Kesar into the chip (colour crossfade on the
 * standard curve) rather than snapping, so the change reads as cause → effect.
 */
export default function Chip({ label, selected = false, onPress, icon }: ChipProps) {
  const colors = useColors();
  const press = usePressMotion(0.94);
  const on = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, { duration: Motion.duration.base, easing: Motion.easing.standard });
  }, [on, selected]);

  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [colors.surfaceRaised, colors.accent]),
  }));
  const ink = useAnimatedStyle(() => ({
    color: interpolateColor(on.value, [0, 1], [colors.text, colors.onAccent]),
  }));

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Animated.View
        style={[
          {
            alignItems: 'center',
            borderRadius: Radius.pill,
            flexDirection: 'row',
            gap: Space[1],
            height: 34,
            paddingHorizontal: Space[4],
          },
          fill,
          press.style,
        ]}
      >
        {icon ? <Ionicons name={icon} size={14} color={selected ? colors.onAccent : colors.text} /> : null}
        <Animated.Text maxFontSizeMultiplier={1.3} style={[Type.captionStrong, ink]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}
