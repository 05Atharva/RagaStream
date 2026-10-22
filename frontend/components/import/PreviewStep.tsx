import { View } from 'react-native';
import { Image } from 'expo-image';
import { Radius, Space } from '../../constants/theme';
import Rise from '../../motion/Rise';
import { moreLabel, songsLabel, type ImportPreview } from '../../services/importLogic';
import { useColors } from '../../theme/ThemeProvider';
import PlaylistCover from '../PlaylistCover';
import Button from '../ui/Button';
import Text from '../ui/Text';
import TextField from '../ui/TextField';
import Notice from './Notice';

const SHOWN = 5;
const COVER = 104;

type PreviewStepProps = {
  preview: ImportPreview;
  name: string;
  onNameChange: (name: string) => void;
  onImport: () => void;
  onBack: () => void;
  loading: boolean;
  offline: boolean;
  error: string | null;
};

/** Step 2. What we found, before anything is saved: cover, name, the first five songs. */
export default function PreviewStep({ preview, name, onNameChange, onImport, onBack, loading, offline, error }: PreviewStepProps) {
  const colors = useColors();
  const rows = preview.tracks.slice(0, SHOWN);
  const more = moreLabel(preview.track_count, rows.length);

  return (
    <View style={{ gap: Space[6] }}>
      <Rise index={0} style={{ alignItems: 'center', flexDirection: 'row', gap: Space[4] }}>
        {preview.cover_url ? (
          <Image source={{ uri: preview.cover_url }} style={{ backgroundColor: colors.surfaceRaised, borderRadius: Radius.md, height: COVER, width: COVER }} contentFit="cover" />
        ) : (
          <PlaylistCover size={COVER} thumbnails={[]} />
        )}
        <View style={{ flex: 1, gap: Space[1] }}>
          <Text variant="headline" numberOfLines={2} accessibilityRole="header">{preview.name}</Text>
          {preview.owner ? <Text variant="caption" color="textSecondary" numberOfLines={1}>{`by ${preview.owner}`}</Text> : null}
          <Text variant="mono" color="textSecondary">{songsLabel(preview.track_count)}</Text>
        </View>
      </Rise>

      {preview.partial && preview.note ? <Notice text={preview.note} /> : null}

      <Rise index={1} style={{ gap: Space[1] }}>
        {rows.map((t) => (
          <View key={t.index} style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: 48 }}>
            <Text variant="mono" color="textTertiary" style={{ textAlign: 'right', width: 24 }}>{t.index + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" numberOfLines={1}>{t.title}</Text>
              {t.artists.length ? <Text variant="caption" color="textSecondary" numberOfLines={1}>{t.artists.join(', ')}</Text> : null}
            </View>
          </View>
        ))}
        {more ? <Text variant="caption" color="textTertiary" style={{ paddingLeft: Space[8] + Space[1], paddingTop: Space[1] }}>{more}</Text> : null}
      </Rise>

      <Rise index={2}>
        <TextField label="Playlist name" icon="musical-notes-outline" value={name} onChangeText={onNameChange} placeholder="Name this playlist" returnKeyType="done" maxLength={100} />
      </Rise>

      {error ? <Notice tone="error" text={error} actionLabel="Retry" onAction={onImport} /> : null}
      {offline ? <Notice icon="cloud-offline-outline" text="You're offline. Connect to the internet to import." /> : null}

      <Rise index={3} style={{ gap: Space[2] }}>
        <Button
          label={`Import ${songsLabel(preview.track_count)}`}
          size="lg"
          fullWidth
          loading={loading}
          disabled={offline || preview.track_count === 0}
          onPress={onImport}
        />
        <Button label="Back" variant="secondary" size="lg" fullWidth onPress={onBack} disabled={loading} />
      </Rise>
    </View>
  );
}
