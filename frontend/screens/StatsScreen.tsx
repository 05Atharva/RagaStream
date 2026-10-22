import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Toast from '../services/toast';
import SkeletonLoader from '../components/SkeletonLoader';
import SongRow from '../components/SongRow';
import Chip from '../components/ui/Chip';
import EmptyState from '../components/ui/EmptyState';
import IconButton from '../components/ui/IconButton';
import SectionHeader from '../components/ui/SectionHeader';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import { useListeningStats, type StatsRange, type TopChannel } from '../hooks/useHistory';
import * as playback from '../services/playbackController';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Layout, Motion, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Stats'>;

const RANGES: Array<{ key: StatsRange; label: string }> = [
  { key: 'short', label: '4 weeks' },
  { key: 'medium', label: '6 months' },
  { key: 'long', label: 'All time' },
];

/** Channel row with a bar that fills to its share of plays, staggered on arrival. */
function ChannelBar({ channel, max, index, onPress }: { channel: TopChannel; max: number; index: number; onPress: () => void }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const fill = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    fill.value = 0;
    fill.value = withDelay(120 + index * 60, withTiming(1, { duration: Motion.duration.slow * 2, easing: Motion.easing.out }));
  }, [channel.plays, fill, index, reduced]);

  const barStyle = useAnimatedStyle(() => ({ width: `${(channel.plays / max) * 100 * fill.value}%` }));

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${channel.channel_name}, ${channel.plays} plays`}
      style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], paddingHorizontal: Layout.gutter, paddingVertical: Space[2] }}>
      <Text variant="mono" color="textTertiary" style={{ width: 18 }} tabular>{index + 1}</Text>
      <Image source={{ uri: channel.thumbnail_url ?? playback.thumbnailFor(channel.top_song.youtube_id) }}
        style={{ backgroundColor: colors.surfaceRaised, borderRadius: Radius.pill, height: 44, width: 44 }} contentFit="cover" />
      <View style={{ flex: 1, gap: Space[1] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Space[2] }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{channel.channel_name}</Text>
          <Text variant="mono" color="textSecondary" tabular>{channel.plays}</Text>
        </View>
        <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: Radius.pill, height: 6, overflow: 'hidden' }}>
          <Animated.View style={[{ backgroundColor: index === 0 ? colors.accent : colors.signal, borderRadius: Radius.pill, height: 6 }, barStyle]} />
        </View>
      </View>
    </Pressable>
  );
}

export default function StatsScreen({ navigation }: Props) {
  const styles = useStyles();
  const [range, setRange] = useState<StatsRange>('short');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { data, isLoading } = useListeningStats(range, 20);
  const topSongs = data?.top_songs ?? [];
  const topChannels = (data?.top_channels ?? []).slice(0, 6);
  const maxPlays = Math.max(1, ...topChannels.map((c) => c.plays));
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;

  const play = async (index: number) => {
    setLoadingId(topSongs[index]?.youtube_id ?? null);
    try {
      await playback.playSongs(topSongs, index, { type: 'home', name: `Your top songs · ${rangeLabel}` });
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't play this song" });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Back" iconSize={26} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: Space[16] }} showsVerticalScrollIndicator={false}>
        <Rise style={styles.hero}>
          <Text variant="label" color="accentInk">Your listening</Text>
          <Text variant="display">What you've been playing</Text>
        </Rise>
        <View style={styles.ranges}>
          {RANGES.map((r) => <Chip key={r.key} label={r.label} selected={range === r.key} onPress={() => setRange(r.key)} />)}
        </View>

        {isLoading ? (
          <View style={{ gap: Space[3], paddingHorizontal: Layout.gutter }}>
            <SkeletonLoader width="45%" height={56} />
            {Array.from({ length: 5 }).map((_, i) => <SkeletonLoader key={i} width="100%" height={48} />)}
          </View>
        ) : !data || data.total_plays === 0 ? (
          <EmptyState icon="stats-chart-outline" title="Your story starts with a few songs" body="Play some music and your top songs and channels will appear here." />
        ) : (
          <>
            <Rise index={1} style={styles.totals}>
              <Text variant="hero" tabular>{data.total_plays}</Text>
              <Text variant="caption" color="textSecondary">plays in the last {rangeLabel.toLowerCase()}</Text>
            </Rise>

            <View style={styles.section}>
              <SectionHeader title="Top channels" />
              {topChannels.map((c, i) => (
                <ChannelBar key={c.channel_name} channel={c} max={maxPlays} index={i} onPress={() => navigation.navigate('Channel', { channelName: c.channel_name })} />
              ))}
            </View>

            <View style={styles.section}>
              <SectionHeader title="Top songs" />
              {topSongs.map((song, i) => (
                <SongRow key={song.id} song={song} index={i + 1} subtitle={`${song.channel_name ?? ''}  ·  ${song.plays} plays`}
                  isLoading={loadingId === song.youtube_id} onPress={() => void play(i)} />
              ))}
            </View>
            <Text variant="caption" color="textTertiary" style={{ marginTop: Space[4], paddingHorizontal: Layout.gutter }}>
              Based on your most recent 200 plays. Private sessions aren't counted.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  header: { paddingHorizontal: Space[2], paddingTop: Space[1] },
  hero: { gap: Space[2], paddingBottom: Space[4], paddingHorizontal: Layout.gutter },
  ranges: { flexDirection: 'row', gap: Space[2], paddingBottom: Space[6], paddingHorizontal: Layout.gutter },
  totals: { gap: Space[1], paddingBottom: Space[6], paddingHorizontal: Layout.gutter },
  section: { marginBottom: Space[6] },
}));
