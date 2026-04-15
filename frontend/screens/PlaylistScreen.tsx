import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { Swipeable } from 'react-native-gesture-handler';
import TrackPlayer from '../services/trackPlayerShim';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore, type Track } from '../store/playerStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Playlist'>;

type SongRecord = {
  id: string;
  youtube_id: string;
  title: string;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
};

type PlaylistRecord = {
  id: string;
  name: string;
  description?: string | null;
  songs?: SongRecord[];
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

export default function PlaylistScreen({ route, navigation }: Props) {
  const { playlistId } = route.params;
  const queryClient = useQueryClient();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [loadingSongId, setLoadingSongId] = useState<string | null>(null);

  const playlistQuery = useQuery({
    queryKey: ['playlist', playlistId],
    queryFn: async () => {
      const { data } = await apiClient.get<PlaylistRecord>(`/playlists/${playlistId}`);
      return data;
    },
  });

  const playlist = playlistQuery.data;
  const songs = playlist?.songs ?? [];
  const totalDuration = useMemo(() => {
    return songs.reduce((sum, song) => sum + (song.duration_sec ?? 0), 0);
  }, [songs]);

  const firstThumb = songs[0]?.thumbnail_url;

  const buildTracks = async (items: SongRecord[]) => {
    const tracks = await Promise.all(
      items.map(async (song) => {
        const { data } = await apiClient.get<{ stream_url: string }>('/youtube/stream', {
          params: { id: song.youtube_id },
        });
        return {
          id: song.id,
          title: song.title,
          artist: song.channel_name || 'Unknown channel',
          album: playlist?.name ?? 'Playlist',
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

  const playTracks = async (items: SongRecord[]) => {
    if (items.length === 0) {
      return;
    }
    try {
      const tracks = await buildTracks(items);
      await TrackPlayer.reset();
      await TrackPlayer.add(tracks);
      await TrackPlayer.play();
      usePlayerStore.setState({
        currentTrack: tracks[0],
        queue: tracks,
        isPlaying: true,
      });
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not start playlist' });
    }
  };

  const handlePlayAll = async () => {
    await playTracks(songs);
  };

  const handleShuffle = async () => {
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    await playTracks(shuffled);
  };

  const handleRename = async () => {
    const nextName = nameDraft.trim();
    if (!nextName || !playlist) {
      setIsEditingName(false);
      return;
    }
    try {
      await apiClient.put(`/playlists/${playlistId}`, { name: nextName });
      await queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not rename playlist' });
    } finally {
      setIsEditingName(false);
    }
  };

  const handleRemoveSong = async (songId: string) => {
    try {
      await apiClient.delete(`/playlists/${playlistId}/songs/${songId}`);
      await queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not remove song' });
    }
  };

  const handleReorder = async (data: SongRecord[]) => {
    try {
      await apiClient.put(`/playlists/${playlistId}/songs/reorder`, {
        song_ids: data.map((song) => song.id),
      });
      queryClient.setQueryData(['playlist', playlistId], (old: PlaylistRecord | undefined) => {
        if (!old) return old;
        return { ...old, songs: data };
      });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not reorder playlist' });
    }
  };

  const handleSongPress = async (song: SongRecord) => {
    setLoadingSongId(song.id);
    await playTracks([song, ...songs.filter((item) => item.id !== song.id)]);
    setLoadingSongId(null);
  };

  const renderSongItem = ({ item, drag, isActive }: RenderItemParams<SongRecord>) => {
    const thumb = item.thumbnail_url;
    return (
      <Swipeable
        renderRightActions={() => (
          <Pressable onPress={() => void handleRemoveSong(item.id)} style={styles.removeButton}>
            <Ionicons name="trash-outline" size={20} color={Colors.onBackground} />
          </Pressable>
        )}
      >
        <Pressable
          onPress={() => void handleSongPress(item)}
          onLongPress={drag}
          style={[styles.songRow, isActive && styles.songRowActive]}
        >
          <Image source={thumb ? { uri: thumb } : undefined} style={styles.songThumb} />
          <View style={styles.songMeta}>
            <Text numberOfLines={1} style={styles.songTitle}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.songSubtitle}>
              {item.channel_name || 'Unknown channel'}
            </Text>
          </View>
          {loadingSongId === item.id ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <Text style={styles.songDuration}>{formatTime(item.duration_sec ?? 0)}</Text>
          )}
        </Pressable>
      </Swipeable>
    );
  };

  if (playlistQuery.isLoading) {
    return (
      <SafeAreaView style={styles.loadingState}>
        <ActivityIndicator color={Colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
        <Ionicons name="chevron-back" size={22} color={Colors.onBackground} />
      </Pressable>

      <View style={styles.hero}>
        {firstThumb ? (
          <Image source={{ uri: firstThumb }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        ) : null}
        <LinearGradient
          colors={['rgba(18,18,18,0.1)', 'rgba(18,18,18,0.85)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.heroContent}>
          {isEditingName ? (
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              onSubmitEditing={() => void handleRename()}
              onBlur={() => void handleRename()}
              style={styles.nameInput}
              autoFocus
            />
          ) : (
            <Pressable
              onLongPress={() => {
                setNameDraft(playlist?.name ?? '');
                setIsEditingName(true);
              }}
            >
              <Text style={styles.heroTitle}>{playlist?.name ?? 'Playlist'}</Text>
            </Pressable>
          )}
          <Text style={styles.heroSubtitle}>
            {songs.length} songs - {formatTime(totalDuration)}
          </Text>
          <View style={styles.heroActions}>
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
      </View>

      <DraggableFlatList
        data={songs}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => void handleReorder(data)}
        renderItem={renderSongItem}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  loadingState: {
    backgroundColor: Colors.background,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    left: Spacing.lg,
    top: Spacing.md,
    zIndex: 2,
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    height: 240,
    justifyContent: 'flex-end',
  },
  heroContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  heroTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
  },
  heroSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 4,
  },
  heroActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
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
  songRowActive: {
    opacity: 0.9,
  },
  songThumb: {
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
  removeButton: {
    backgroundColor: Colors.error,
    borderRadius: BorderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  nameInput: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
    borderBottomColor: Colors.onBackground,
    borderBottomWidth: 1,
    paddingBottom: 4,
  },
});

