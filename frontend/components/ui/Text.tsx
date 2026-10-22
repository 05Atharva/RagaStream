import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { Type, type TextVariant, type ThemeColors } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';

type ColorKey = keyof Pick<
  ThemeColors,
  'text' | 'textSecondary' | 'textTertiary' | 'accentInk' | 'onAccent' | 'signal' | 'danger' | 'success' | 'warning'
>;

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  /** A theme colour key, or any colour string for artwork-tinted surfaces. */
  color?: ColorKey | (string & {});
  align?: 'left' | 'center' | 'right';
  tabular?: boolean;
};

const COLOR_KEYS = new Set([
  'text', 'textSecondary', 'textTertiary', 'accentInk', 'onAccent', 'signal', 'danger', 'success', 'warning',
]);

/** The only text primitive in the app: every string uses a named type role. */
export default function Text({
  variant = 'body',
  color = 'text',
  align,
  tabular,
  style,
  maxFontSizeMultiplier = 1.35,
  ...rest
}: TextProps) {
  const colors = useColors();
  const resolved = COLOR_KEYS.has(color) ? colors[color as ColorKey] : color;
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        Type[variant],
        { color: resolved },
        align ? { textAlign: align } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
      {...rest}
    />
  );
}
