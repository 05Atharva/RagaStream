import React from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { usePressMotion } from '../../motion/primitives';

type TappableProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /** Scale on press. Large cards use a gentler 0.98. */
  pressScale?: number;
};

/**
 * Anything tappable that isn't a button: cards, tiles, rows. Presses compress
 * and release with follow-through instead of changing colour.
 */
export default function Tappable({ style, children, pressScale, onPressIn, onPressOut, ...rest }: TappableProps) {
  const press = usePressMotion(pressScale);
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        press.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.onPressOut();
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, press.style]}>{children}</Animated.View>
    </Pressable>
  );
}
