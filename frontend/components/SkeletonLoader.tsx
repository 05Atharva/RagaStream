import React, { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Motion, Radius } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';

type Props = {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

const SWEEP_WIDTH = 220;

/**
 * Loading placeholder. The highlight glides across on the Meend curve and
 * rests between passes, like a breath, rather than looping mechanically.
 */
export default function SkeletonLoader({ width, height, borderRadius = Radius.sm, style }: Props) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Motion.easing.glide }),
        withDelay(350, withTiming(0, { duration: 0 }))
      ),
      -1
    );
    return () => cancelAnimation(progress);
  }, [progress, reduced]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-SWEEP_WIDTH, 420]) }],
  }));

  return (
    <View style={[{ width, height, borderRadius, backgroundColor: colors.skeleton, overflow: 'hidden' }, style]}>
      {!reduced ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, width: SWEEP_WIDTH }, sweepStyle]}>
          <LinearGradient
            colors={[colors.skeleton, colors.skeletonHighlight, colors.skeleton]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
