import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Motion, Radius, Space } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';
import Text from './ui/Text';

type Props = {
  visible: boolean;
};

/**
 * Shown while a dropped stream is being re-fetched. Drops in from the top on
 * `out`, leaves on `in`; the arc spinner is the only loop (a loading state).
 */
export default function ReconnectingToast({ visible }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const show = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    show.value = withTiming(visible ? 1 : 0, {
      duration: visible ? Motion.duration.glide : Motion.duration.base,
      easing: visible ? Motion.easing.out : Motion.easing.in,
    });
    if (visible) {
      spin.value = 0;
      spin.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    } else {
      cancelAnimation(spin);
    }
  }, [show, spin, visible]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity: show.value,
    transform: [{ translateY: (show.value - 1) * 16 }],
  }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[{ position: 'absolute', top: insets.top + Space[2], left: 0, right: 0, alignItems: 'center', zIndex: 20 }, wrapStyle]}
    >
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.text,
          borderRadius: Radius.pill,
          flexDirection: 'row',
          gap: Space[2],
          paddingHorizontal: Space[4],
          paddingVertical: Space[2],
        }}
      >
        <Animated.View style={spinStyle}>
          <Svg width={14} height={14} viewBox="0 0 14 14">
            <Circle cx={7} cy={7} r={5.5} stroke={colors.accent} strokeWidth={2} fill="none" strokeDasharray="26 9" strokeLinecap="round" />
          </Svg>
        </Animated.View>
        <Text variant="captionStrong" color={colors.bg}>Reconnecting…</Text>
      </View>
    </Animated.View>
  );
}
