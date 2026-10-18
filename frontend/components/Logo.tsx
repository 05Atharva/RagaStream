import React, { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Brand, Fonts, Motion } from '../constants/theme';
import { useTheme } from '../theme/ThemeProvider';
import Text from './ui/Text';

/**
 * The Meend mark: one unbroken stroke — an R whose leg glides into a stream —
 * ending in a Neel dot, the note it lands on.
 */
export const MEEND_PATH =
  'M14 54 V14 Q14 11 17 11 H33 Q47 11 47 23.5 Q47 36 33 36 H24 C31 36 33 44 39 48.5 C44 52 49 49.5 52 45.5';
const PATH_LENGTH = 149; // measured from the curve segments above
const DOT = { cx: 55.5, cy: 41.5, r: 3.6 };

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type MarkProps = {
  size?: number;
  /** Draw the stroke on mount (splash, milestones). */
  animate?: boolean;
  delay?: number;
  onDrawn?: () => void;
  /** Override colours (e.g. monochrome on an accent fill). */
  stroke?: string;
  dot?: string;
};

export function MeendMark({ size = 48, animate = false, delay = 0, onDrawn, stroke, dot }: MarkProps) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const play = animate && !reduced;
  const draw = useSharedValue(play ? 0 : 1);
  const land = useSharedValue(play ? 0 : 1);

  useEffect(() => {
    if (!play) {
      onDrawn?.();
      return;
    }
    // The stroke glides in like a held note; the dot lands as the line arrives.
    draw.value = withDelay(delay, withTiming(1, { duration: 1100, easing: Motion.easing.glide }));
    land.value = withDelay(
      delay + 900,
      withSequence(
        withTiming(1.4, { duration: 220, easing: Motion.easing.out }),
        withTiming(1, { duration: 200, easing: Motion.easing.standard }, (finished) => {
          if (finished && onDrawn) runOnJS(onDrawn)();
        })
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const pathProps = useAnimatedProps(() => ({ strokeDashoffset: PATH_LENGTH * (1 - draw.value) }));
  const dotProps = useAnimatedProps(() => ({ r: DOT.r * land.value }));

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="RagaStream">
      <AnimatedPath
        d={MEEND_PATH}
        fill="none"
        stroke={stroke ?? (isDark ? Brand.kesar : '#E8620A')}
        strokeWidth={6.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={PATH_LENGTH}
        animatedProps={pathProps}
      />
      <AnimatedCircle cx={DOT.cx} cy={DOT.cy} fill={dot ?? (isDark ? Brand.neelLight : Brand.neelDeep)} animatedProps={dotProps} />
    </Svg>
  );
}

type LogoProps = MarkProps & { wordmark?: boolean };

/** Mark + wordmark lockup. */
export default function Logo({ size = 48, wordmark = false, ...rest }: LogoProps) {
  if (!wordmark) return <MeendMark size={size} {...rest} />;
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: size * 0.22 }}>
      <MeendMark size={size} {...rest} />
      <Text style={{ fontFamily: Fonts.display, fontSize: size * 0.5, lineHeight: size * 0.6, letterSpacing: -size * 0.016 }}>
        RagaStream
      </Text>
    </View>
  );
}
