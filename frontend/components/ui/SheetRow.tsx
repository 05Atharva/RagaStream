import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Layout, Radius, Space } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import { usePressMotion } from '../../motion/primitives';
import Text from './Text';

type SheetRowProps = {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Custom leading element (e.g. an animated LikeButton or a cover). */
  leading?: React.ReactNode;
  detail?: string;
  trailing?: React.ReactNode;
  selected?: boolean;
  destructive?: boolean;
};

/** A row inside a bottom sheet: 52pt tall, icon + label + optional detail. */
export default function SheetRow({ label, onPress, icon, leading, detail, trailing, selected, destructive }: SheetRowProps) {
  const colors = useColors();
  const press = usePressMotion(0.98);
  const tint = destructive ? colors.danger : selected ? colors.accentInk : colors.text;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Animated.View
        style={[
          {
            alignItems: 'center',
            borderRadius: Radius.sm,
            flexDirection: 'row',
            gap: Space[4],
            minHeight: 52,
            paddingHorizontal: Space[2],
          },
          press.style,
        ]}
      >
        {leading ?? (icon ? (
          <View style={{ alignItems: 'center', width: Layout.touchTarget - 16 }}>
            <Ionicons name={icon} size={22} color={destructive ? colors.danger : colors.textSecondary} />
          </View>
        ) : null)}
        <View style={{ flex: 1, gap: 2, paddingVertical: Space[2] }}>
          <Text variant="bodyStrong" color={tint}>{label}</Text>
          {detail ? <Text variant="caption" color="textSecondary">{detail}</Text> : null}
        </View>
        {trailing ?? (selected ? <Ionicons name="checkmark" size={20} color={colors.accentInk} /> : null)}
      </Animated.View>
    </Pressable>
  );
}

/** Sheet title block with an optional trailing control. */
export function SheetHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], marginBottom: Space[3], paddingHorizontal: Space[2] }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="caption" color="textSecondary">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}
