import React, { type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Motion } from '../constants/theme';

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  disabled?: boolean;
};

// Typed as `any` to avoid conflict with Pressable's function-style `style` prop
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnimatedPressable = Animated.createAnimatedComponent(Pressable) as any;

/** Tappable card with the standard press feedback: a quick scale to 97%. */
export default function PressableCard({
  onPress,
  onLongPress,
  style,
  children,
  hitSlop,
  disabled,
}: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      onPressIn={() => {
        scale.value = withTiming(Motion.pressScale, { duration: Motion.duration.fast, easing: Motion.easing.standard });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: Motion.duration.quick, easing: Motion.easing.standard });
      }}
      hitSlop={hitSlop}
      disabled={disabled}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
