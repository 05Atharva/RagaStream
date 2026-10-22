import React, { forwardRef, useEffect, useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Motion, Radius, Space, Type } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import Text from './Text';

type TextFieldProps = TextInputProps & {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  error?: string | null;
  /** Adds a show/hide toggle and hides the text by default. */
  secure?: boolean;
  /** A taller, top-aligned box for pasting lists (pair with `multiline`). */
  tall?: boolean;
};

/**
 * Labelled input. Focus pours Kesar into the border (colour crossfade), so the
 * active field is obvious at a glance; errors sit directly under the field.
 */
const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, icon, error, secure = false, tall = false, onFocus, onBlur, style, ...rest },
  ref
) {
  const colors = useColors();
  const [hidden, setHidden] = useState(secure);
  const focus = useSharedValue(0);
  const hasError = Boolean(error);

  useEffect(() => {
    if (hasError) focus.value = withTiming(1, { duration: Motion.duration.quick });
  }, [focus, hasError]);

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: hasError ? colors.danger : interpolateColor(focus.value, [0, 1], [colors.border, colors.accent]),
  }));

  return (
    <View style={{ gap: Space[2] }}>
      <Text variant="captionStrong" color="textSecondary">{label}</Text>
      <Animated.View
        style={[
          {
            alignItems: tall ? 'flex-start' : 'center',
            backgroundColor: colors.surface,
            borderRadius: Radius.md,
            borderWidth: 1.5,
            flexDirection: 'row',
            gap: Space[3],
            ...(tall ? { minHeight: 168, paddingTop: Space[4] } : { height: 54 }),
            paddingHorizontal: Space[4],
          },
          borderStyle,
        ]}
      >
        <Ionicons name={icon} size={19} color={colors.textTertiary} style={tall ? { marginTop: 1 } : undefined} />
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={hidden}
          onFocus={(e) => {
            focus.value = withTiming(1, { duration: Motion.duration.base, easing: Motion.easing.standard });
            onFocus?.(e);
          }}
          onBlur={(e) => {
            focus.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.standard });
            onBlur?.(e);
          }}
          accessibilityLabel={label}
          style={[Type.bodyStrong, { color: colors.text, flex: 1, height: tall ? undefined : '100%', minHeight: tall ? 128 : undefined, textAlignVertical: tall ? 'top' : undefined }, style]}
          {...rest}
        />
        {secure ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={12} accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? <Text variant="caption" color="danger">{error}</Text> : null}
    </View>
  );
});

export default TextField;
