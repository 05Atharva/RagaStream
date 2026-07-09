import React, { useEffect } from 'react';
import { Dimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const SCREEN_W = Dimensions.get('window').width;
const GRADIENT_W = SCREEN_W * 3;

type Props = {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

export default function SkeletonLoader({ width, height, borderRadius = 8, style }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.linear }),
      -1,
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [0, SCREEN_W * 2.5]) },
    ],
  }));

  return (
    <View
      style={[
        { width, height, borderRadius, backgroundColor: '#1A1A1A', overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', top: 0, left: -SCREEN_W * 2, width: GRADIENT_W, height },
          shimmerStyle,
        ]}
      >
        <LinearGradient
          colors={['#1A1A1A', '#1A1A1A', '#252525', '#2A2A2A', '#252525', '#1A1A1A', '#1A1A1A']}
          locations={[0, 0.3, 0.45, 0.5, 0.55, 0.7, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: GRADIENT_W, height }}
        />
      </Animated.View>
    </View>
  );
}
