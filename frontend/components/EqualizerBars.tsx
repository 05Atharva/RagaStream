import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type EqualizerBarsProps = {
  isPlaying: boolean;
  color?: string;
  size?: 'sm' | 'md';
};

type SizeKey = NonNullable<EqualizerBarsProps['size']>;

const SIZE_CONFIG: Record<SizeKey, { barWidth: number; gap: number; maxHeight: number }> = {
  sm: {
    barWidth: 3,
    gap: 2,
    maxHeight: 16,
  },
  md: {
    barWidth: 4,
    gap: 3,
    maxHeight: 24,
  },
};

const RESTING_RATIO = 0.3;
const MIN_ACTIVE_RATIO = 0.35;
const ACTIVE_STEP_COUNT = 5;
const MIN_DURATION_MS = 300;
const MAX_DURATION_MS = 600;

const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;

const buildLoopAnimation = (restingHeight: number, maxHeight: number) => {
  const steps = Array.from({ length: ACTIVE_STEP_COUNT }, () =>
    withTiming(randomBetween(maxHeight * MIN_ACTIVE_RATIO, maxHeight), {
      duration: Math.round(randomBetween(MIN_DURATION_MS, MAX_DURATION_MS)),
      easing: Easing.inOut(Easing.ease),
    })
  );

  return withRepeat(
    withSequence(
      ...steps,
      withTiming(restingHeight, {
        duration: Math.round(randomBetween(MIN_DURATION_MS, MAX_DURATION_MS)),
        easing: Easing.inOut(Easing.ease),
      })
    ),
    -1,
    false
  );
};

export default function EqualizerBars({
  isPlaying,
  color = '#7C3AED',
  size = 'sm',
}: EqualizerBarsProps) {
  const { barWidth, gap, maxHeight } = SIZE_CONFIG[size];
  const restingHeight = Math.max(2, maxHeight * RESTING_RATIO);

  const barOne = useSharedValue(restingHeight);
  const barTwo = useSharedValue(restingHeight);
  const barThree = useSharedValue(restingHeight);
  const barFour = useSharedValue(restingHeight);

  useEffect(() => {
    const bars = [barOne, barTwo, barThree, barFour];

    if (isPlaying) {
      bars.forEach((bar, index) => {
        cancelAnimation(bar);
        bar.value = withDelay(index * 80, buildLoopAnimation(restingHeight, maxHeight));
      });
      return;
    }

    bars.forEach((bar) => {
      cancelAnimation(bar);
      bar.value = withTiming(restingHeight, {
        duration: 200,
        easing: Easing.out(Easing.ease),
      });
    });
  }, [barFour, barOne, barThree, barTwo, isPlaying, maxHeight, restingHeight]);

  const barOneStyle = useAnimatedStyle(() => ({
    height: barOne.value,
  }));
  const barTwoStyle = useAnimatedStyle(() => ({
    height: barTwo.value,
  }));
  const barThreeStyle = useAnimatedStyle(() => ({
    height: barThree.value,
  }));
  const barFourStyle = useAnimatedStyle(() => ({
    height: barFour.value,
  }));

  return (
    <View style={[styles.container, { gap, height: maxHeight }]}>
      <Animated.View style={[styles.bar, { backgroundColor: color, width: barWidth }, barOneStyle]} />
      <Animated.View style={[styles.bar, { backgroundColor: color, width: barWidth }, barTwoStyle]} />
      <Animated.View style={[styles.bar, { backgroundColor: color, width: barWidth }, barThreeStyle]} />
      <Animated.View style={[styles.bar, { backgroundColor: color, width: barWidth }, barFourStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-end',
    flexDirection: 'row',
  },
  bar: {
    alignSelf: 'flex-end',
    borderRadius: 999,
    minHeight: 2,
  },
});
