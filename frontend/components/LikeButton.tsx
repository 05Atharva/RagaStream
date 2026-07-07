import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type LikeButtonProps = {
  isLiked: boolean;
  onToggle: () => void;
  size?: number;
};

type ParticleProps = {
  angle: number;
  burstId: number;
  color: string;
  distance: number;
};

const GOLD = '#F5A623';
const GRAY = 'rgba(255,255,255,0.7)';
const PURPLE = '#7C3AED';
const PARTICLE_SIZE = 4;
const PARTICLE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const LIKE_POP = { damping: 10, stiffness: 300 };
const UNLIKE_POP = { damping: 10, stiffness: 300 };
const AnimatedIonicons = Animated.createAnimatedComponent(
  Ionicons as React.ComponentType<React.ComponentProps<typeof Ionicons>>
);

function Particle({ angle, burstId, color, distance }: ParticleProps) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (burstId === 0) {
      return;
    }

    const radians = (angle * Math.PI) / 180;
    x.value = 0;
    y.value = 0;
    opacity.value = 1;
    x.value = withTiming(Math.cos(radians) * distance, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
    y.value = withTiming(Math.sin(radians) * distance, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(0, { duration: 500 });
  }, [angle, burstId, distance, opacity, x, y]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return <Animated.View style={[styles.particle, { backgroundColor: color }, animatedStyle]} />;
}

export default function LikeButton({ isLiked, onToggle, size = 24 }: LikeButtonProps) {
  const [burstId, setBurstId] = useState(0);
  const previousLikedRef = useRef(isLiked);
  const scale = useSharedValue(1);
  const colorProgress = useSharedValue(isLiked ? 1 : 0);
  const burstTrigger = useSharedValue(0);
  const touchSize = Math.max(size + 16, 40);
  const particleDistance = Math.max(size * 0.9, 22);

  const startBurst = useCallback(() => {
    setBurstId((value) => value + 1);
  }, []);

  useEffect(() => {
    const wasLiked = previousLikedRef.current;
    previousLikedRef.current = isLiked;

    if (wasLiked === isLiked) {
      colorProgress.value = isLiked ? 1 : 0;
      return;
    }

    if (isLiked) {
      scale.value = withSequence(
        withSpring(1.3, LIKE_POP),
        withSpring(1, LIKE_POP)
      );
      colorProgress.value = withTiming(1, { duration: 500 });
      burstTrigger.value = withTiming(burstTrigger.value + 1, { duration: 0 }, (finished) => {
        if (finished) {
          runOnJS(startBurst)();
        }
      });
      return;
    }

    scale.value = withSequence(
      withSpring(1.15, UNLIKE_POP),
      withSpring(1, UNLIKE_POP)
    );
    colorProgress.value = withTiming(0, { duration: 220 });
  }, [burstTrigger, colorProgress, isLiked, scale, startBurst]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const animatedIconProps = useAnimatedProps(() => ({
    color: interpolateColor(colorProgress.value, [0, 1], [GRAY, GOLD]),
  }));

  return (
    <Pressable
      hitSlop={8}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.button,
        { height: touchSize, width: touchSize },
        pressed && styles.buttonPressed,
      ]}
    >
      <Animated.View style={iconStyle}>
        <AnimatedIonicons
          animatedProps={animatedIconProps}
          name={isLiked ? 'heart' : 'heart-outline'}
          size={size}
        />
      </Animated.View>

      <View pointerEvents="none" style={styles.particles}>
        {PARTICLE_ANGLES.map((angle, index) => (
          <Particle
            key={angle}
            angle={angle}
            burstId={burstId}
            color={index % 2 === 0 ? PURPLE : GOLD}
            distance={particleDistance}
          />
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    position: 'relative',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  particles: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'visible',
  },
  particle: {
    borderRadius: PARTICLE_SIZE / 2,
    height: PARTICLE_SIZE,
    left: '50%',
    marginLeft: -PARTICLE_SIZE / 2,
    marginTop: -PARTICLE_SIZE / 2,
    position: 'absolute',
    top: '50%',
    width: PARTICLE_SIZE,
  },
});
