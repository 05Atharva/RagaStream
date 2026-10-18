import React from 'react';
import { Pressable, View } from 'react-native';
import { Layout, Space } from '../../constants/theme';
import Text from './Text';

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Horizontal padding; defaults to the screen gutter. */
  inset?: number;
};

/** Section title with optional subtitle and a quiet trailing action. */
export default function SectionHeader({ title, subtitle, actionLabel, onAction, inset = Layout.gutter }: SectionHeaderProps) {
  return (
    <View
      style={{
        alignItems: 'flex-end',
        flexDirection: 'row',
        gap: Space[3],
        marginBottom: Space[3],
        paddingHorizontal: inset,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="headline" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="caption" color="textSecondary">{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Text variant="captionStrong" color="accentInk">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
