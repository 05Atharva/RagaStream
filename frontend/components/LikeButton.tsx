import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Brand, Motion } from '../constants/theme';
import { useColors, useTheme } from '../theme/ThemeProvider';

type LikeButtonProps = {
  isLiked: boolean;
  onToggle: () => void;
  size?: number;
  /** Outline colour when not liked (e.g. white on artwork-tinted surfaces). */
  idleColor?: string;
};

const STROKES = [0, 60, 120, 180, 240, 300];
const AnimatedIonicons = Animated.createAnimatedComponent(
  Ionicons as React.ComponentType<React.ComponentProps<typeof Ionicons>>
);

/**
 * A short glide stroke that leaves the heart on a curve: it travels outward
 * while rotating 24°, so its path bends like a meend rather than a straight
 * spark. Kesar and Neel alternate.
 */
function GlideStroke({ angle, burst, color, distance }: { angle: number; burst: number; color: string; distance: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (burst === 0) return;
    t.value = 0;
    t.value = withTiming(1, { duration: 520, easing: Motion.easing.out });
  }, [burst, t]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const bend = (angle + p * 24) * (Math.PI / 180);
    const r = 6 + p * distance;
    return {
      opacity: p === 0 ? 0 : 1 - p,
      transform: [
        { translateX: Math.cos(bend) * r },
        { translateY: Math.sin(bend) * r },
        { rotate: `${angle + 90 + p * 24}deg` },
        { scaleY: 1 - p * 0.6 },
      ],
    };
  });

  return <Animated.View style={[styles.stroke, { backgroundColor: color }, style]} />;
}

/**
 * Like: anticipation (squash on press) → pop (heart fills Kesar and stretches
 * up) → follow-through (settles) with a burst of glide strokes. Unliking is
 * deliberately quieter: a small dip, no burst.
 */
export default function LikeButton({ isLiked, onToggle, size = 24, idleColor }: LikeButtonProps) {
  const colors = useColors();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const [burst, setBurst] = useState(0);
  const previous = useRef(isLiked);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const fill = useSharedValue(isLiked ? 1 : 0);
  const idle = idleColor ?? colors.textSecondary;
  const liked = isDark ? Brand.kesar : '#E8620A';
  const touch = Math.max(size + 20, 44);

  useEffect(() => {
    const was = previous.current;
    previous.current = isLiked;
    if (was === isLiked) {
      fill.value = isLiked ? 1 : 0;
      return;
    }
    fill.value = withTiming(isLiked ? 1 : 0, { duration: Motion.duration.base, easing: Motion.easing.standard });
    if (reduced) return;
    if (isLiked) {
      scaleX.value = withSequence(
        withTiming(1.18, { duration: 140, easing: Motion.easing.out }),
        withTiming(0.96, { duration: 120, easing: Motion.easing.standard }),
        withTiming(1, { duration: 140, easing: Motion.easing.standard })
      );
      scaleY.value = withSequence(
        withTiming(1.3, { duration: 140, easing: Motion.easing.out }),
        withTiming(0.92, { duration: 120, easing: Motion.easing.standard }),
        withTiming(1, { duration: 140, easing: Motion.easing.standard })
      );
      setBurst((b) => b + 1);
    } else {
      scaleX.value = withSequence(withTiming(0.88, { duration: 110 }), withTiming(1, { duration: 160, easing: Motion.easing.out }));
      scaleY.value = withSequence(withTiming(0.88, { duration: 110 }), withTiming(1, { duration: 160, easing: Motion.easing.out }));
    }
  }, [fill, isLiked, reduced, scaleX, scaleY]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: scaleX.value }, { scaleY: scaleY.value }] }));
  const iconProps = useAnimatedProps(() => ({ color: interpolateColor(fill.value, [0, 1], [idle, liked]) }));

  return (
    <Pressable
      onPress={onToggle}
      onPressIn={() => {
        if (reduced) return;
        scaleX.value = withTiming(0.86, { duration: Motion.duration.instant, easing: Motion.easing.out });
        scaleY.value = withTiming(0.86, { duration: Motion.duration.instant, easing: Motion.easing.out });
      }}
      onPressOut={() => {
        if (reduced) return;
        if (scaleX.value < 1) {
          scaleX.value = withTiming(1, { duration: Motion.duration.quick, easing: Motion.easing.out });
          scaleY.value = withTiming(1, { duration: Motion.duration.quick, easing: Motion.easing.out });
        }
      }}
      accessibilityRole="button"
      accessibilityLabel={isLiked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
      accessibilityState={{ selected: isLiked }}
      style={[styles.button, { width: touch, height: touch }]}
    >
      <Animated.View style={iconStyle}>
        <AnimatedIonicons animatedProps={iconProps} name={isLiked ? 'heart' : 'heart-outline'} size={size} />
      </Animated.View>
      <View pointerEvents="none" style={styles.burst}>
        {STROKES.map((angle, i) => (
          <GlideStroke
            key={angle}
            angle={angle}
            burst={burst}
            color={i % 2 === 0 ? liked : isDark ? Brand.neelLight : Brand.neelDeep}
            distance={size * 0.95}
          />
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  burst: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  stroke: { borderRadius: 2, height: 7, position: 'absolute', width: 2.5 },
});
