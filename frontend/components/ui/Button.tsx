import React from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Layout, Radius, Space } from '../../constants/theme';
import { makeStyles, useColors } from '../../theme/ThemeProvider';
import { usePressMotion } from '../../motion/primitives';
import { tapHaptic } from '../../services/haptics';
import Text from './Text';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

const HEIGHT: Record<Size, number> = { sm: 36, md: Layout.touchTarget, lg: 52 };
const PAD: Record<Size, number> = { sm: Space[4], md: Space[5], lg: Space[6] };

/** Kesar `primary` is reserved for the single most important action on a screen. */
export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const styles = useStyles();
  const colors = useColors();
  const press = usePressMotion();
  const inactive = disabled || loading;

  const fg =
    variant === 'primary' ? colors.onAccent
    : variant === 'ghost' ? colors.accentInk
    : variant === 'danger' ? colors.danger
    : colors.text;

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[fullWidth && styles.fullWidth, style]}
    >
      <Animated.View
        style={[
          styles.base,
          styles[variant],
          { height: HEIGHT[size], paddingHorizontal: PAD[size] },
          inactive && styles.inactive,
          press.style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={fg} size="small" />
        ) : (
          <View style={styles.content}>
            {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={fg} /> : null}
            <Text variant={size === 'sm' ? 'captionStrong' : 'subtitle'} color={fg}>
              {label}
            </Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  fullWidth: { alignSelf: 'stretch' },
  base: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    justifyContent: 'center',
  },
  content: { alignItems: 'center', flexDirection: 'row', gap: Space[2] },
  primary: { backgroundColor: t.colors.accent },
  secondary: { backgroundColor: t.colors.surfaceRaised },
  outline: { borderColor: t.colors.border, borderWidth: 1.5 },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: t.colors.dangerSoft },
  inactive: { opacity: 0.45 },
}));
