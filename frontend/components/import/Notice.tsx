import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Space } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import Button from '../ui/Button';
import Text from '../ui/Text';

type NoticeProps = {
  tone?: 'info' | 'error';
  icon?: ComponentProps<typeof Ionicons>['name'];
  text: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** A quiet card for a note, an error or an offline message, with an optional Retry. */
export default function Notice({ tone = 'info', icon, text, actionLabel, onAction }: NoticeProps) {
  const colors = useColors();
  const error = tone === 'error';
  return (
    <View
      accessibilityRole={error ? 'alert' : undefined}
      style={{
        backgroundColor: error ? colors.dangerSoft : colors.surfaceRaised,
        borderRadius: Radius.md,
        gap: Space[2],
        padding: Space[4],
      }}
    >
      <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: Space[3] }}>
        <Ionicons
          name={icon ?? (error ? 'alert-circle-outline' : 'information-circle-outline')}
          size={20}
          color={error ? colors.danger : colors.signal}
          style={{ marginTop: 1 }}
        />
        <Text variant="caption" color={error ? 'danger' : 'textSecondary'} style={{ flex: 1 }}>{text}</Text>
      </View>
      {actionLabel && onAction ? (
        <View style={{ alignItems: 'flex-start', paddingLeft: Space[8] - Space[1] }}>
          <Button label={actionLabel} variant="outline" size="md" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
