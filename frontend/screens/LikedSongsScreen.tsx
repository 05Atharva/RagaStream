import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import TrackPlayer from 'react-native-track-player';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import { usePlayerStore, type Track } from '../store/playerStore';

type SongRecord = {
  id: string;
  youtube_id: string;
  title: string;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function LikedSongsScreen() {
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);

  const likedQuery = useQuery({
    queryKey: ['liked'],
    queryFn: async () => {
      const { data } = await apiClient.get<SongRecord[]>('/liked');
      return data;
    },
  });

  const likedSongs = likedQuery.data ?? [];

  const buildTracks = async (songs: SongRecord[]) => {
    const tracks = await Promise.all(
      songs.map(async (song) => {
        const { data } = await apiClient.get<{ stream_url: string }>('/youtube/stream', {
          params: { id: song.youtube_id },
        });
        return {
          id: song.id,
          title: song.title,
          artist: song.channel_name || 'Unknown channel',
          album: 'Liked Songs',
          artwork: song.thumbnail_url || '',
          url: data.stream_url,
          source: 'youtube',
          youtubeId: song.youtube_id,
          channelName: song.channel_name || undefined,
          thumbnailUrl: song.thumbnail_url || undefined,
        } as Track;
      })
    );
    return tracks;
  };

  const playTracks = async (songs: SongRecord[], startIndex = 0) => {
    try {
      const tracks = await buildTracks(songs);
      const reordered = startIndex === 0 ? tracks : [...tracks.slice(startIndex), ...tracks.slice(0, startIndex)];

      await TrackPlayer.reset();
      await TrackPlayer.add(reordered);
      await TrackPlayer.play();

      usePlayerStore.setState({
        currentTrack: reordered[0],
        queue: reordered,
        isPlaying: true,
      });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not start playback' });
    }
  };

  const handlePlayAll = async () => {
    await playTracks(likedSongs, 0);
  };

  const handleShuffle = async () => {
    const shuffled = [...likedSongs].sort(() => Math.random() - 0.5);
    await playTracks(shuffled, 0);
  };

  const handlePlayFromSong = async (songId: string) => {
    const index = likedSongs.findIndex((song) => song.id === songId);
    if (index === -1) {
      return;
    }
    setLoadingTrackId(songId);
    await playTracks(likedSongs, index);
    setLoadingTrackId(null);
  };

  const totalDuration = useMemo(() => {
    return likedSongs.reduce((sum, song) => sum + (song.duration_sec ?? 0), 0);
  }, [likedSongs]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Liked Songs</Text>
          <Text style={styles.subtitle}>
            {likedSongs.length} songs - {formatTime(totalDuration)}
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => void handleShuffle()} style={styles.secondaryButton}>
            <Ionicons name="shuffle" size={18} color={Colors.onBackground} />
            <Text style={styles.secondaryButtonText}>Shuffle</Text>
          </Pressable>
          <Pressable onPress={() => void handlePlayAll()} style={styles.primaryButton}>
            <Ionicons name="play" size={18} color={Colors.onPrimary} />
            <Text style={styles.primaryButtonText}>Play All</Text>
          </Pressable>
        </View>
      </View>

      {likedQuery.isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlashList
          data={likedSongs}
          keyExtractor={(item) => item.id}
          estimatedItemSize={84}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => void handlePlayFromSong(item.id)} style={styles.songRow}>
              <Image source={item.thumbnail_url ? { uri: item.thumbnail_url } : undefined} style={styles.thumb} />
              <View style={styles.songMeta}>
                <Text numberOfLines={1} style={styles.songTitle}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={styles.songSubtitle}>
                  {item.channel_name || 'Unknown channel'}
                </Text>
              </View>
              {loadingTrackId === item.id ? (
                <ActivityIndicator color={Colors.primary} />
              ) : (
                <Text style={styles.songDuration}>{formatTime(item.duration_sec ?? 0)}</Text>
              )}
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No liked songs yet.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  title: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
  },
  subtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.full,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  primaryButtonText: {
    color: Colors.onPrimary,
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightBold,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightSemiBold,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 120,
  },
  songRow: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    flexDirection: 'row',
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  thumb: {
    borderRadius: BorderRadius.sm,
    height: 56,
    width: 56,
    backgroundColor: Colors.border,
  },
  songMeta: {
    flex: 1,
    marginHorizontal: Spacing.sm,
  },
  songTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemiBold,
  },
  songSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 2,
  },
  songDuration: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
  },
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  emptyText: {
    color: Colors.muted,
    fontSize: Typography.fontSizeMd,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
