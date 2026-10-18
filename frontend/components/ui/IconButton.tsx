import React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Layout, Radius } from '../../constants/theme';
import { makeStyles, useColors } from '../../theme/ThemeProvider';
import { usePressMotion } from '../../motion/primitives';
import { tapHaptic } from '../../services/haptics';

type IconButtonProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  accessibilityLabel: string;
  variant?: 'plain' | 'tonal' | 'accent';
  size?: number;
  iconSize?: number;
  /** Overrides the icon colour (e.g. active shuffle, artwork-tinted surfaces). */
  color?: string;
  disabled?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Circular icon control with a 44pt minimum touch target. */
export default function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  size = Layout.touchTarget,
  iconSize = 22,
  color,
  disabled = false,
  haptic = true,
  style,
}: IconButtonProps) {
  const styles = useStyles();
  const colors = useColors();
  const press = usePressMotion(0.9);
  const fg = color ?? (variant === 'accent' ? colors.onAccent : colors.text);
  const hit = Math.max(0, (Layout.touchTarget - size) / 2);

  return (
    <Pressable
      onPress={() => {
        if (haptic) tapHaptic();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled}
      hitSlop={hit}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      <Animated.View
        style={[
          styles.base,
          { width: size, height: size },
          variant === 'tonal' && styles.tonal,
          variant === 'accent' && styles.accent,
          disabled && styles.disabled,
          press.style,
        ]}
      >
        <Ionicons name={icon} size={iconSize} color={fg} />
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  base: { alignItems: 'center', borderRadius: Radius.pill, justifyContent: 'center' },
  tonal: { backgroundColor: t.colors.surfaceRaised },
  accent: { backgroundColor: t.colors.accent },
  disabled: { opacity: 0.4 },
}));
