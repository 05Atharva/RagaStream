import React from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Radius, Space } from '../constants/theme';
import { useTheme } from '../theme/ThemeProvider';
import { usePressMotion } from '../motion/primitives';
import Text from './ui/Text';

type GoogleButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

function GoogleG() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}

/** Google's own button styling (white, multicolour G) per their brand rules. */
export default function GoogleButton({ label, onPress, disabled = false, loading = false }: GoogleButtonProps) {
  const { isDark } = useTheme();
  const press = usePressMotion();
  return (
    <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} disabled={disabled || loading}
      accessibilityRole="button" accessibilityLabel={label}>
      <Animated.View
        style={[
          {
            alignItems: 'center',
            backgroundColor: '#FFFFFF',
            borderColor: isDark ? 'transparent' : 'rgba(11,15,26,0.12)',
            borderRadius: Radius.pill,
            borderWidth: 1,
            flexDirection: 'row',
            gap: Space[3],
            height: 54,
            justifyContent: 'center',
            opacity: disabled ? 0.5 : 1,
          },
          press.style,
        ]}
      >
        {loading ? <ActivityIndicator color="#1F1F1F" /> : (
          <>
            <GoogleG />
            <Text variant="subtitle" color="#1F1F1F">{label}</Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}
