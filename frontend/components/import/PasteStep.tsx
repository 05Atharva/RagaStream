import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Toast from '../../services/toast';
import { Space } from '../../constants/theme';
import Rise from '../../motion/Rise';
import { classifyInput, listLineCount, songsLabel } from '../../services/importLogic';
import Button from '../ui/Button';
import Text from '../ui/Text';
import TextField from '../ui/TextField';
import Notice from './Notice';
import SourceChips from './SourceChips';

type PasteStepProps = {
  value: string;
  onChange: (value: string) => void;
  onFind: () => void;
  loading: boolean;
  offline: boolean;
  error: string | null;
};

const EXAMPLE = 'Kesariya - Arijit Singh\nTum Hi Ho - Arijit Singh\nChaiyya Chaiyya - Sukhwinder Singh';

/**
 * Step 1. One field: a link stays a single line; anything else turns it into
 * the "Paste your song list" box. Clipboard is read only when Paste is tapped.
 */
export default function PasteStep({ value, onChange, onFind, loading, offline, error }: PasteStepProps) {
  const kind = classifyInput(value);
  const isList = kind === 'text';

  const paste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text.trim()) onChange(text.trim());
      else Toast.show({ type: 'info', text1: 'Your clipboard is empty', text2: 'Copy a playlist link, then tap Paste.' });
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't read the clipboard", text2: 'Hold your finger on the box to paste instead.' });
    }
  };

  return (
    <View style={{ gap: Space[6] }}>
      <Rise index={0} style={{ gap: Space[2] }}>
        <Text variant="display" accessibilityRole="header">Import a playlist</Text>
        <Text variant="body" color="textSecondary">
          Paste a link from Spotify, YouTube, YouTube Music or Apple Music. For anything else, paste the song list.
        </Text>
      </Rise>

      <Rise index={1} style={{ gap: Space[3] }}>
        <TextField
          label={isList ? 'Paste your song list' : 'Playlist link'}
          icon={isList ? 'list-outline' : 'link-outline'}
          value={value}
          onChangeText={onChange}
          placeholder={isList ? EXAMPLE : 'https://open.spotify.com/playlist/...'}
          multiline={isList}
          tall={isList}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={isList ? 'default' : 'url'}
          returnKeyType={isList ? 'default' : 'go'}
          onSubmitEditing={isList ? undefined : onFind}
        />
        <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="mono" color="textTertiary">
            {isList ? `${songsLabel(listLineCount(value))} · one per line` : 'Link or song list'}
          </Text>
          <Button label="Paste" variant="ghost" icon="clipboard-outline" onPress={() => void paste()} accessibilityLabel="Paste from clipboard" />
        </View>
      </Rise>

      {error ? <Notice tone="error" text={error} actionLabel="Retry" onAction={onFind} /> : null}
      {offline ? <Notice icon="cloud-offline-outline" text="You're offline. Connect to the internet to find songs." /> : null}

      <Rise index={2} style={{ gap: Space[3] }}>
        <Text variant="label" color="textTertiary">Works with</Text>
        <SourceChips />
      </Rise>

      <Rise index={3}>
        <Button label="Find songs" size="lg" fullWidth loading={loading} disabled={kind === 'empty' || offline} onPress={onFind} />
      </Rise>
    </View>
  );
}
