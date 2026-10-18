import React from 'react';
import { View } from 'react-native';
import { Space } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';
import Text from './ui/Text';

export default function AuthDivider({ label = 'or' }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3] }}>
      <View style={{ backgroundColor: colors.border, flex: 1, height: 1 }} />
      <Text variant="caption" color="textTertiary">{label}</Text>
      <View style={{ backgroundColor: colors.border, flex: 1, height: 1 }} />
    </View>
  );
}
