import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import { playTrack } from '../services/audioPlayer';
import { ensureSongInCatalogue } from '../services/songService';
import { recordPlayHistory } from '../services/historyService';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore, type Track } from '../store/playerStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Channel'>;

type YouTubeSearchResult = {
  youtube_id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0:00';
  }
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function ChannelScreen({ route, navigation }: Props) {
  const { channelName } = route.params;
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: results, isLoading } = useQuery({
    queryKey: ['channel-songs', channelName],
    queryFn: async () => {
      const { data } = await apiClient.get<YouTubeSearchResult[]>('/youtube/search', {
        params: { q: channelName, limit: 20 },
      });
      return data;
    },
  });

  const handlePlay = async (item: YouTubeSearchResult) => {
    if (loadingId) return;
    setLoadingId(item.youtube_id);

    try {
      const cataloguePromise = ensureSongInCatalogue({
        youtube_id: item.youtube_id,
        title: item.title,
        channel_name: item.channel,
        thumbnail_url: item.thumbnail,
        duration_sec: item.duration,
      }).catch(() => item.youtube_id);

      const { data } = await apiClient.get<{ stream_url: string }>('/youtube/stream', {
        params: { id: item.youtube_id },
      });

      const songId = await cataloguePromise;

      const track: Track = {
        id: songId,
        title: item.title,
        artist: item.channel,
        album: channelName,
        artwork: item.thumbnail,
        url: data.stream_url,
        source: 'youtube',
        youtubeId: item.youtube_id,
        channelName: item.channel,
        thumbnailUrl: item.thumbnail,
      };

      await playTrack(track);
      usePlayerStore.setState({ currentTrack: track, queue: [track], isPlaying: true });
      void recordPlayHistory(songId);
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not play this track' });
    } finally {
      setLoadingId(null);
    }
  };

  const listHeader = (
    <View style={styles.artistHeader}>
      <View style={styles.artistAvatar}>
        <Ionicons name="person" size={48} color="rgba(210,187,255,0.55)" />
      </View>
      <Text style={styles.channelTitle} numberOfLines={2}>
        {channelName}
      </Text>
      <Text style={styles.channelSubtitle}>
        {results?.length ?? 0} tracks found
      </Text>
      <Text style={styles.tracksLabel}>Popular Tracks</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backRow}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.9)" />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color="#7C3AED" size="large" />
        </View>
      ) : (
        <FlashList
          data={results ?? []}
          keyExtractor={(item) => item.youtube_id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader}
          renderItem={({ item }) => {
            const isActive = loadingId === item.youtube_id;
            return (
              <Pressable
                style={({ pressed }) => [styles.songRow, pressed && styles.cardPressed]}
                onPress={() => void handlePlay(item)}
              >
                <View style={styles.songThumbWrap}>
                  <Image
                    source={{ uri: item.thumbnail }}
                    style={StyleSheet.absoluteFillObject}
                    contentFit="cover"
                  />
                  {isActive && (
                    <View style={styles.thumbOverlay}>
                      <ActivityIndicator color="#7C3AED" size="small" />
                    </View>
                  )}
                </View>
                <View style={styles.songMeta}>
                  <Text numberOfLines={1} style={styles.songTitle}>{item.title}</Text>
                  <Text numberOfLines={1} style={styles.songSubtitle}>{item.channel}</Text>
                </View>
                <Text style={styles.songDuration}>{formatTime(item.duration)}</Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No songs found for this artist.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  backRow: {
    paddingBottom: 4,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  loadingState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  list: {
    paddingBottom: 120,
    paddingHorizontal: 20,
  },

  // ── Artist header (ListHeaderComponent) ──
  artistHeader: {
    alignItems: 'center',
    paddingBottom: 24,
    paddingTop: 8,
  },
  artistAvatar: {
    alignItems: 'center',
    backgroundColor: '#1a1c1c',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
    borderWidth: 2,
    elevation: 12,
    height: 120,
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    width: 120,
  },
  channelTitle: {
    color: '#e2e2e2',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  channelSubtitle: {
    color: 'rgba(204,195,216,0.75)',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 24,
  },
  tracksLabel: {
    alignSelf: 'flex-start',
    color: '#e2e2e2',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },

  // ── Song rows ──
  songRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  songThumbWrap: {
    backgroundColor: '#333535',
    borderRadius: 8,
    flexShrink: 0,
    height: 56,
    overflow: 'hidden',
    width: 56,
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
  },
  songMeta: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    color: '#e2e2e2',
    fontSize: 16,
    fontWeight: '600',
  },
  songSubtitle: {
    color: 'rgba(204,195,216,0.75)',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  songDuration: {
    color: 'rgba(204,195,216,0.65)',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyText: {
    color: 'rgba(204,195,216,0.5)',
    fontSize: 15,
    marginTop: 24,
    textAlign: 'center',
  },
});
