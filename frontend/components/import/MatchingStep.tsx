import { FlatList, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Layout, Space } from '../../constants/theme';
import { checkedCount, progressFraction, type ImportItem, type ImportJob } from '../../services/importLogic';
import { useColors } from '../../theme/ThemeProvider';
import SkeletonLoader from '../SkeletonLoader';
import Button from '../ui/Button';
import CheckMark from '../ui/CheckMark';
import Text from '../ui/Text';
import MeendProgress from './MeendProgress';
import Notice from './Notice';

type MatchingStepProps = {
  /** Undefined until the first poll lands. */
  job: ImportJob | undefined;
  /** The first poll failed (no data yet). */
  loadError: string | null;
  /** A later poll failed; the last known state stays on screen. */
  reconnecting: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onBackToPreview: () => void;
};

/** One song in the live list: hollow while pending, Pour to Kesar when found, a quiet label when not. */
function MatchRow({ item }: { item: ImportItem }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: 52 }}>
      {item.status === 'not_found' ? (
        <View style={{ alignItems: 'center', height: 24, justifyContent: 'center', width: 24 }}>
          <Ionicons name="remove-circle-outline" size={22} color={colors.textTertiary} />
        </View>
      ) : (
        <CheckMark checked={item.status === 'matched'} />
      )}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" color={item.status === 'pending' ? 'textSecondary' : 'text'} numberOfLines={1}>{item.title}</Text>
        {item.artists.length ? <Text variant="caption" color="textTertiary" numberOfLines={1}>{item.artists.join(', ')}</Text> : null}
      </View>
      {item.status === 'not_found' ? <Text variant="caption" color="textTertiary">Not found</Text> : null}
    </View>
  );
}

/** Step 3. The Meend line fills as songs are matched; the list ticks underneath. */
export default function MatchingStep({ job, loadError, reconnecting, onCancel, onRetry, onBackToPreview }: MatchingStepProps) {
  if (loadError) {
    return (
      <View style={{ gap: Space[4], paddingHorizontal: Layout.gutter }}>
        <Notice tone="error" text={loadError} actionLabel="Retry" onAction={onRetry} />
        <Button label="Back" variant="secondary" onPress={onBackToPreview} />
      </View>
    );
  }
  if (!job) {
    return (
      <View style={{ gap: Space[4], paddingHorizontal: Layout.gutter }}>
        <SkeletonLoader width="100%" height={44} />
        <SkeletonLoader width="40%" height={14} />
        {Array.from({ length: 5 }).map((_, i) => <SkeletonLoader key={i} width="100%" height={40} />)}
      </View>
    );
  }

  const failed = job.status === 'failed';
  const building = job.status === 'creating';
  const status = failed
    ? 'Stopped'
    : building
      ? 'Building your playlist'
      : job.total > 0
        ? `Matching ${checkedCount(job)} of ${job.total}`
        : 'Getting started';

  const header = (
    <View style={{ gap: Space[3], paddingBottom: Space[3] }}>
      <Text variant="headline" numberOfLines={2} accessibilityRole="header">{job.name}</Text>
      <MeendProgress fraction={progressFraction(job)} />
      <Text variant="mono" color="textSecondary" accessibilityLiveRegion="polite">{status}</Text>
      {failed ? (
        <Notice tone="error" text={job.error || 'The import stopped before it finished.'} actionLabel="Try again" onAction={onRetry} />
      ) : (
        <Text variant="caption" color="textTertiary">{"You can leave this screen. We'll tell you when it's ready."}</Text>
      )}
      {reconnecting ? <Text variant="caption" color="textTertiary">Reconnecting...</Text> : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={job.items}
        keyExtractor={(i) => String(i.index)}
        renderItem={({ item }) => <MatchRow item={item} />}
        extraData={job.matched + job.not_found}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: Space[4], paddingHorizontal: Layout.gutter }}
        showsVerticalScrollIndicator={false}
      />
      {failed ? null : (
        <View style={{ alignItems: 'center', paddingBottom: Space[3], paddingHorizontal: Layout.gutter }}>
          <Button label="Cancel" variant="ghost" onPress={onCancel} />
        </View>
      )}
    </View>
  );
}
