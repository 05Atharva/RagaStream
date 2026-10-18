import React, { useEffect } from 'react';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  interpolate,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Motion } from '../constants/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// The play triangle is split into two quads at x=13.5 so each half can morph
// into one pause bar. Points are [x, y] in a 24×24 box, clockwise.
const PLAY_LEFT = [[7, 4], [13.5, 7.7], [13.5, 16.3], [7, 20]];
const PLAY_RIGHT = [[13.5, 7.7], [20, 12], [20, 12], [13.5, 16.3]];
const PAUSE_LEFT = [[6, 5], [10, 5], [10, 19], [6, 19]];
const PAUSE_RIGHT = [[14, 5], [18, 5], [18, 19], [14, 19]];

function quad(from: number[][], to: number[][], t: number) {
  'worklet';
  let d = '';
  for (let i = 0; i < 4; i += 1) {
    const x = interpolate(t, [0, 1], [from[i][0], to[i][0]]);
    const y = interpolate(t, [0, 1], [from[i][1], to[i][1]]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

type Props = {
  playing: boolean;
  size?: number;
  color: string;
};

/**
 * Play ⇄ pause as one shape that reshapes itself (squash-and-stretch of the
 * glyph) instead of swapping two icons. 220ms on the `out` curve.
 */
export default function PlayPauseIcon({ playing, size = 28, color }: Props) {
  const reduced = useReducedMotion();
  const t = useSharedValue(playing ? 1 : 0);

  useEffect(() => {
    t.value = withTiming(playing ? 1 : 0, {
      duration: reduced ? 1 : 220,
      easing: Motion.easing.out,
    });
  }, [playing, reduced, t]);

  const leftProps = useAnimatedProps(() => ({ d: quad(PLAY_LEFT, PAUSE_LEFT, t.value) }));
  const rightProps = useAnimatedProps(() => ({ d: quad(PLAY_RIGHT, PAUSE_RIGHT, t.value) }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <AnimatedPath animatedProps={leftProps} fill={color} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <AnimatedPath animatedProps={rightProps} fill={color} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}
