import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import SafeBlurView from './SafeBlurView';

// Circumference of r=5.5 circle ≈ 34.6; draw ~75% (26px) with 9px gap
const ARC_DASH: [number, number] = [26, 9];

type Props = {
  visible: boolean;
};

export default function ReconnectingToast({ visible }: Props) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-12);
  const spinVal = useSharedValue(0);

  // Spinner rotates continuously, independent of visibility
  useEffect(() => {
    spinVal.value = withRepeat(
      withTiming(360, { duration: 800, easing: Easing.linear }),
      -1,
    );
  }, [spinVal]);

  // Entrance / exit driven entirely by `visible`
  useEffect(() => {
    if (visible) {
      opacity.value = withSpring(1, { damping: 20 });
      translateY.value = withSpring(0, { damping: 20 });
    } else {
      opacity.value = withTiming(0, { duration: 250 });
      translateY.value = withTiming(-12, { duration: 250 });
    }
  }, [visible, opacity, translateY]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinVal.value}deg` }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.wrapper, containerStyle]}>
      <View style={styles.pill}>
        {/* Blur layer — clipped by pill's overflow:hidden + borderRadius */}
        <SafeBlurView
          blurAmount={24}
          blurType="dark"
          reducedTransparencyFallbackColor="#121414"
          style={StyleSheet.absoluteFillObject}
        />
        {/* Glass tint + content row */}
        <View style={styles.content}>
          <Animated.View style={spinnerStyle}>
            <Svg width={16} height={16} viewBox="0 0 16 16">
              <Circle
                cx="8"
                cy="8"
                r="5.5"
                fill="none"
                stroke="#7C3AED"
                strokeWidth={2}
                strokeDasharray={ARC_DASH}
                strokeLinecap="round"
              />
            </Svg>
          </Animated.View>
          <Text style={styles.label}>RECONNECTING...</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 8,
    zIndex: 999,
  },
  pill: {
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  content: {
    alignItems: 'center',
    backgroundColor: 'rgba(18,20,20,0.70)',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  label: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
});
