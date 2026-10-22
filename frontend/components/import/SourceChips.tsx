import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Space } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import Text from '../ui/Text';

type IconName = ComponentProps<typeof Ionicons>['name'];

const SOURCES: Array<{ label: string; icon: IconName }> = [
  { label: 'Spotify', icon: 'musical-notes-outline' },
  { label: 'YouTube', icon: 'logo-youtube' },
  { label: 'YouTube Music', icon: 'play-circle-outline' },
  { label: 'Apple Music', icon: 'logo-apple' },
  { label: 'Song list', icon: 'list-outline' },
];

/** Which apps work. Information only, so they are quiet pills, not buttons and not Kesar. */
export default function SourceChips() {
  const colors = useColors();
  return (
    <View accessible accessibilityLabel="Works with Spotify, YouTube, YouTube Music, Apple Music and a pasted song list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space[2] }}>
      {SOURCES.map((s) => (
        <View
          key={s.label}
          style={{ alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: Radius.pill, flexDirection: 'row', gap: Space[1], height: 32, paddingHorizontal: Space[3] }}
        >
          <Ionicons name={s.icon} size={14} color={colors.textSecondary} />
          <Text variant="captionStrong" color="textSecondary">{s.label}</Text>
        </View>
      ))}
    </View>
  );
}
