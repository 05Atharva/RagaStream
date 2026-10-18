import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Toast from 'react-native-toast-message';
import SongRow from '../components/SongRow';
import { useListeningStats, type StatsRange } from '../hooks/useHistory';
import * as playback from '../services/playbackController';
import { tapHaptic } from '../services/haptics';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors, TypeScale } from '../constants/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Stats'>;

const RANGES: Array<{ key: StatsRange; label: string }> = [
  { key: 'short', label: 'Last 4 weeks' },
  { key: 'medium', label: 'Last 6 months' },
  { key: 'long', label: 'All time' },
];

export default function StatsScreen({ navigation }: Props) {
  const [range, setRange] = useState<StatsRange>('short');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { data, isLoading } = useListeningStats(range, 20);
  const topSongs = data?.top_songs ?? [];
  const topChannels = data?.top_channels ?? [];
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;

  const play = async (index: number) => {
    setLoadingId(topSongs[index]?.youtube_id ?? null);
    try {
      await playback.playSongs(topSongs, index, { type: 'home', name: `Your top songs · ${rangeLabel}` });
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not play this track' });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Your listening stats</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.rangeRow}>
          {RANGES.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => {
                tapHaptic();
                setRange(r.key);
              }}
              style={[styles.rangeChip, range === r.key && styles.rangeChipActive]}
            >
              <Text style={styles.rangeText}>{r.label}</Text>
            </Pressable>
          ))}
        </View>

        {isLoading ? (
          <ActivityIndicator color={Colors.primary} style={styles.loader} />
        ) : !data || data.total_plays === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="stats-chart-outline" size={48} color={Colors.primaryLight} />
            <Text style={styles.emptyTitle}>Not enough listening yet</Text>
            <Text style={styles.emptyBody}>Play a few songs and your top songs and channels will show up here.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.totalPlays}>
              {data.total_plays} plays · {rangeLabel.toLowerCase()}
            </Text>

            <Text style={styles.sectionTitle}>Top channels</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelStrip}>
              {topChannels.map((channel, index) => (
                <Pressable
                  key={channel.channel_name}
                  onPress={() => navigation.navigate('Channel', { channelName: channel.channel_name })}
                  style={styles.channelTile}
                >
                  <Image
                    source={{ uri: channel.thumbnail_url ?? playback.thumbnailFor(channel.top_song.youtube_id) }}
                    style={styles.channelImage}
                    contentFit="cover"
                  />
                  <Text numberOfLines={2} style={styles.channelName}>
                    {index + 1}. {channel.channel_name}
                  </Text>
                  <Text style={styles.channelPlays}>{channel.plays} plays</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.sectionTitle}>Top songs</Text>
            {topSongs.map((song, index) => (
              <SongRow
                key={song.id}
                song={song}
                index={index + 1}
                subtitle={`${song.channel_name ?? ''} · ${song.plays} plays`}
                isLoading={loadingId === song.youtube_id}
                onPress={() => void play(index)}
              />
            ))}
            <Text style={styles.footnote}>Based on your most recent 200 plays.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    fontWeight: '700',
  },
  content: {
    paddingBottom: 48,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rangeChip: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  rangeChipActive: {
    backgroundColor: Colors.primary,
  },
  rangeText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  loader: {
    marginTop: 64,
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 64,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    fontWeight: '700',
    marginTop: 16,
  },
  emptyBody: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 8,
    textAlign: 'center',
  },
  totalPlays: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 24,
    paddingHorizontal: 16,
  },
  channelStrip: {
    gap: 16,
    paddingHorizontal: 16,
  },
  channelTile: {
    width: 112,
  },
  channelImage: {
    borderRadius: 999,
    height: 112,
    width: 112,
  },
  channelName: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
    marginTop: 8,
  },
  channelPlays: {
    color: Colors.textSubdued,
    fontSize: TypeScale.caption,
    marginTop: 2,
  },
  footnote: {
    color: Colors.textMuted,
    fontSize: TypeScale.caption,
    marginTop: 16,
    paddingHorizontal: 16,
  },
});
