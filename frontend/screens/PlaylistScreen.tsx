import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore, type Track } from '../store/playerStore';
import { recordPlayHistory } from '../services/historyService';
import SafeBlurView from '../components/SafeBlurView';

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
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDuration(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function PlaylistScreen({ route, navigation }: Props) {
  const { playlistId } = route.params;
  const queryClient = useQueryClient();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [loadingSongId, setLoadingSongId] = useState<string | null>(null);
  const currentTrack = usePlayerStore((state) => state.currentTrack);

  const playlistQuery = useQuery({
    queryKey: ['playlist', playlistId],
    queryFn: async () => {
      const { data } = await apiClient.get<PlaylistRecord>(`/playlists/${playlistId}`);
      return data;
    },
  });

  const playlist = playlistQuery.data;
  const songs = playlist?.songs ?? [];
  const totalDuration = useMemo(
    () => songs.reduce((sum, s) => sum + (s.duration_sec ?? 0), 0),
    [songs],
  );
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
    if (items.length === 0) return;
    try {
      const tracks = await buildTracks(items);
      await TrackPlayer.reset();
      await TrackPlayer.add(tracks);
      await TrackPlayer.play();
      usePlayerStore.setState({ currentTrack: tracks[0], queue: tracks, isPlaying: true });
      void recordPlayHistory(tracks[0].id);
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not start playlist' });
    }
  };

  const handlePlayAll = async () => { await playTracks(songs); };

  const handleShuffle = async () => {
    await playTracks([...songs].sort(() => Math.random() - 0.5));
  };

  const handleRename = async () => {
    const nextName = nameDraft.trim();
    if (!nextName || !playlist) { setIsEditingName(false); return; }
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
        song_ids: data.map((s) => s.id),
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

  const handleDeletePlaylist = () => {
    Alert.alert(
      'Delete Playlist',
      `Are you sure you want to delete "${playlist?.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/playlists/${playlistId}`);
              await queryClient.invalidateQueries({ queryKey: ['playlists'] });
              Toast.show({ type: 'success', text1: 'Playlist deleted' });
              navigation.goBack();
            } catch {
              Toast.show({ type: 'error', text1: 'Could not delete playlist' });
            }
          },
        },
      ]
    );
  };

  const renderSongItem = ({ item, drag, isActive }: RenderItemParams<SongRecord>) => {
    const isCurrentTrack = currentTrack?.id === item.id;
    const isLoadingThis = loadingSongId === item.id;

    return (
      <Swipeable
        renderRightActions={() => (
          <Pressable
            onPress={() => void handleRemoveSong(item.id)}
            style={styles.removeButton}
          >
            <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
          </Pressable>
        )}
      >
        <Pressable
          onPress={() => void handleSongPress(item)}
          onLongPress={drag}
          style={[styles.songRow, isActive && styles.songRowActive]}
        >
          <View style={styles.songThumbWrap}>
            {item.thumbnail_url ? (
              <Image
                source={{ uri: item.thumbnail_url }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
              />
            ) : (
              <Ionicons name="musical-notes" size={18} color="rgba(255,255,255,0.3)" />
            )}
            {isCurrentTrack && (
              <View style={[StyleSheet.absoluteFillObject, styles.nowPlayingOverlay]}>
                <Ionicons name="bar-chart-outline" size={16} color="#7C3AED" />
              </View>
            )}
          </View>

          <View style={styles.songMeta}>
            <Text
              numberOfLines={1}
              style={[styles.songTitle, isCurrentTrack && styles.songTitleActive]}
            >
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.songSubtitle}>
              {item.channel_name || 'Unknown channel'}
            </Text>
          </View>

          {isLoadingThis ? (
            <ActivityIndicator color="#7C3AED" size="small" />
          ) : (
            <Text style={styles.songDuration}>{formatTime(item.duration_sec ?? 0)}</Text>
          )}

          <Ionicons name="reorder-three-outline" size={20} color="rgba(255,255,255,0.3)" />
        </Pressable>
      </Swipeable>
    );
  };

  // Header only shown when list has songs; negative margin breaks out of list's 20px padding
  const renderHeader = () => {
    if (songs.length === 0) return null;
    return (
      <>
        <View style={styles.hero}>
          {firstThumb ? (
            <Image
              source={{ uri: firstThumb }}
              style={[StyleSheet.absoluteFillObject, styles.heroBgImage]}
              contentFit="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, styles.heroBgFallback]} />
          )}
          <SafeBlurView
            blurAmount={40}
            blurType="dark"
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.82)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.heroContent}>
            <View style={styles.heroArtWrap}>
              {firstThumb ? (
                <Image
                  source={{ uri: firstThumb }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                />
              ) : (
                <Ionicons name="musical-notes" size={56} color="rgba(255,255,255,0.25)" />
              )}
            </View>

            {isEditingName ? (
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                onSubmitEditing={() => void handleRename()}
                onBlur={() => void handleRename()}
                style={styles.nameInput}
                placeholderTextColor="rgba(255,255,255,0.45)"
                autoFocus
              />
            ) : (
              <Pressable
                onLongPress={() => {
                  setNameDraft(playlist?.name ?? '');
                  setIsEditingName(true);
                }}
              >
                <Text numberOfLines={2} style={styles.heroTitle}>
                  {playlist?.name ?? 'Playlist'}
                </Text>
              </Pressable>
            )}

            <Text style={styles.heroSubtitle}>
              {songs.length} songs · {formatDuration(totalDuration)}
            </Text>

            <View style={styles.heroActions}>
              <Pressable
                onPress={() => void handlePlayAll()}
                style={({ pressed }) => [styles.playBtn, pressed && styles.cardPressed]}
              >
                <Ionicons name="play" size={26} color="#FFFFFF" />
              </Pressable>
              <Pressable
                onPress={() => void handleShuffle()}
                style={({ pressed }) => [styles.shuffleBtn, pressed && styles.cardPressed]}
              >
                <Ionicons name="shuffle" size={18} color="#e2e2e2" />
                <Text style={styles.shuffleBtnText}>Shuffle</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.controlsRow}>
          <Pressable
            onPress={handleDeletePlaylist}
            style={({ pressed }) => [styles.controlsIconBtn, pressed && styles.cardPressed]}
          >
            <Ionicons name="trash-outline" size={20} color="#ef5350" />
          </Pressable>
          <Pressable
            onPress={() => (navigation as any).navigate('Search')}
            style={({ pressed }) => [styles.addSongsBtn, pressed && styles.cardPressed]}
          >
            <Text style={styles.addSongsBtnText}>Add Songs</Text>
          </Pressable>
        </View>
      </>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconWrap}>
        <View style={[StyleSheet.absoluteFillObject, styles.emptyRingOuter]} />
        <View style={[StyleSheet.absoluteFillObject, styles.emptyRingInner]} />
        <Ionicons name="musical-notes-outline" size={56} color="rgba(210,187,255,0.8)" />
      </View>
      <Text style={styles.emptyTitle}>This playlist is empty</Text>
      <Text style={styles.emptySubtitle}>Add your first song to get started</Text>
      <Pressable
        onPress={() => (navigation as any).navigate('Search')}
        style={({ pressed }) => [styles.emptyBtn, pressed && styles.cardPressed]}
      >
        <Ionicons name="add" size={20} color="#ede0ff" />
        <Text style={styles.emptyBtnText}>Add Songs</Text>
      </Pressable>
    </View>
  );

  if (playlistQuery.isLoading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color="#7C3AED" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Pressable
        onPress={() => navigation.goBack()}
        style={({ pressed }) => [styles.backButton, pressed && styles.cardPressed]}
      >
        <Ionicons name="chevron-back" size={22} color="#e2e2e2" />
      </Pressable>

      <DraggableFlatList
        data={songs}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => void handleReorder(data)}
        renderItem={renderSongItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0c0f0f',
    flex: 1,
  },
  loadingState: {
    alignItems: 'center',
    backgroundColor: '#0c0f0f',
    flex: 1,
    justifyContent: 'center',
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(26,28,28,0.75)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    left: 16,
    position: 'absolute',
    top: 8,
    width: 40,
    zIndex: 10,
  },
  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginHorizontal: -20,  // break out of list's contentContainerStyle padding
    minHeight: 380,
    overflow: 'hidden',
    paddingTop: 56,
  },
  heroBgImage: {
    transform: [{ scale: 1.1 }],  // avoid blur edge artefacts
  },
  heroBgFallback: {
    backgroundColor: '#1a1c1c',
  },
  heroContent: {
    alignItems: 'center',
    paddingBottom: 28,
    paddingHorizontal: 20,
    width: '100%',
  },
  heroArtWrap: {
    alignItems: 'center',
    backgroundColor: '#333535',
    borderRadius: 12,
    elevation: 20,
    height: 192,
    justifyContent: 'center',
    marginBottom: 20,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    width: 192,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  heroSubtitle: {
    color: 'rgba(204,195,216,0.9)',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.15,
    marginBottom: 24,
  },
  heroActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  playBtn: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 999,
    elevation: 8,
    height: 56,
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    width: 56,
  },
  shuffleBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    paddingHorizontal: 24,
  },
  shuffleBtnText: {
    color: '#e2e2e2',
    fontSize: 18,
    fontWeight: '600',
  },
  nameInput: {
    borderBottomColor: 'rgba(255,255,255,0.4)',
    borderBottomWidth: 1,
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 8,
    minWidth: 200,
    paddingBottom: 4,
    textAlign: 'center',
  },
  // ── Controls row ──────────────────────────────────────────────────────────
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingVertical: 12,
  },
  controlsIconBtn: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  addSongsBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  addSongsBtnText: {
    color: '#7C3AED',
    fontSize: 18,
    fontWeight: '600',
  },
  // ── Song list ──────────────────────────────────────────────────────────────
  list: {
    paddingBottom: 120,
    paddingHorizontal: 20,
  },
  songRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  songRowActive: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    opacity: 0.9,
  },
  songThumbWrap: {
    alignItems: 'center',
    backgroundColor: '#333535',
    borderRadius: 8,
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
  },
  nowPlayingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
  },
  songMeta: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    color: '#e2e2e2',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  songTitleActive: {
    color: '#7C3AED',
  },
  songSubtitle: {
    color: 'rgba(204,195,216,0.85)',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  songDuration: {
    color: 'rgba(204,195,216,0.6)',
    fontSize: 14,
    fontWeight: '500',
  },
  removeButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#C62828',
    borderRadius: 8,
    justifyContent: 'center',
    marginBottom: 4,
    paddingHorizontal: 20,
  },
  // ── Empty state ────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingBottom: 60,
    paddingHorizontal: 20,
    paddingTop: 80,
  },
  emptyIconWrap: {
    alignItems: 'center',
    backgroundColor: '#1a1c1c',
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
    borderWidth: 1,
    height: 128,
    justifyContent: 'center',
    marginBottom: 32,
    width: 128,
  },
  emptyRingOuter: {
    borderColor: 'rgba(124,58,237,0.2)',
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.5,
    transform: [{ scale: 1.15 }],
  },
  emptyRingInner: {
    borderColor: 'rgba(124,58,237,0.1)',
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.3,
    transform: [{ scale: 1.3 }],
  },
  emptyTitle: {
    color: '#e2e2e2',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: 'rgba(204,195,216,0.7)',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    marginBottom: 32,
    textAlign: 'center',
  },
  emptyBtn: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 999,
    elevation: 8,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 12,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  emptyBtnText: {
    color: '#ede0ff',
    fontSize: 18,
    fontWeight: '600',
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
});
