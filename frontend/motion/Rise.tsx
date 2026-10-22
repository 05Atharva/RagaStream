import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRise } from './primitives';

type RiseProps = {
  index?: number;
  /** Milliseconds to wait before the stagger starts. */
  delay?: number;
  /** Pass false to render at rest (e.g. on tab revisits). */
  play?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/** Wraps content in the Meend entrance: a short rise on the `out` curve. */
export default function Rise({ index = 0, delay = 0, play = true, style, children }: RiseProps) {
  const riseStyle = useRise(index, play, delay);
  return <Animated.View style={[style, riseStyle]}>{children}</Animated.View>;
}
