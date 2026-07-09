import React, { type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  disabled?: boolean;
};

// Typed as `any` to avoid conflict with Pressable's function-style `style` prop
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnimatedPressable = Animated.createAnimatedComponent(Pressable) as any;

export default function PressableCard({
  onPress,
  style,
  children,
  hitSlop,
  disabled,
}: Props) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.96, { damping: 20, stiffness: 300 });
        opacity.value = withTiming(0.85, { duration: 100 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 20, stiffness: 300 });
        opacity.value = withTiming(1, { duration: 100 });
      }}
      hitSlop={hitSlop}
      disabled={disabled}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
