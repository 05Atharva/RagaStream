import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import { BottomSheetFlatList, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import TrackPlayer from 'react-native-track-player';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import { ensureSongInCatalogue } from '../services/songService';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import { usePlayerStore, type Track } from '../store/playerStore';

type Props = BottomTabScreenProps<BottomTabParamList, 'Search'>;

type YouTubeSearchResult = {
  youtube_id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
};

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
  songs?: SongRecord[];
};

const GENRE_CARDS = [
  { label: 'Bollywood', color: '#FF6B6B' },
  { label: 'Classical', color: '#4ECDC4' },
  { label: 'Folk', color: '#45B7D1' },
  { label: 'Devotional', color: '#FFA07A' },
  { label: 'Indie', color: '#98D8C8' },
  { label: 'Punjabi', color: '#FFD93D' },
  { label: 'Ghazals', color: '#C084FC' },
  { label: 'Sufi', color: '#86EFAC' },
] as const;

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARS = 2;

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function SearchScreen({ route, navigation }: Props) {
  const [searchText, setSearchText] = useState(route.params?.initialQuery ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedResult, setSelectedResult] = useState<YouTubeSearchResult | null>(null);
  const [isRowLoading, setIsRowLoading] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuSheetRef = useRef<BottomSheetModal>(null);
  const playlistSheetRef = useRef<BottomSheetModal>(null);

  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const addToQueue = usePlayerStore((state) => state.addToQueue);

  useEffect(() => {
    if (route.params?.initialQuery) {
      setSearchText(route.params.initialQuery);
      setDebouncedQuery(route.params.initialQuery);
    }
  }, [route.params?.initialQuery]);

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    const trimmed = searchText.trim();

    if (trimmed.length < MIN_SEARCH_CHARS) {
      setDebouncedQuery('');
      return;
    }

    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchText]);

  const {
    data: results,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['youtube-search', debouncedQuery],
    enabled: debouncedQuery.length >= MIN_SEARCH_CHARS,
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<YouTubeSearchResult[]>('/youtube/search', {
        params: { q: debouncedQuery, limit: 20 },
        signal,
      });
      return data;
    },
  });

  const snapPoints = useMemo(() => ['30%', '48%'], []);
  const playlistSnapPoints = useMemo(() => ['50%', '75%'], []);

  const handlePlayResult = async (item: YouTubeSearchResult) => {
    if (isRowLoading) {
      return;
    }

    setIsRowLoading(item.youtube_id);

    try {
      const songId = await ensureSongInCatalogue({
        youtube_id: item.youtube_id,
        title: item.title,
        channel_name: item.channel,
        thumbnail_url: item.thumbnail,
        duration_sec: item.duration,
      });
      const { data } = await apiClient.get<{ stream_url: string }>('/youtube/stream', {
        params: { id: item.youtube_id },
      });

      const track: Track = {
        id: songId,
        title: item.title,
        artist: item.channel,
        album: 'YouTube',
        artwork: item.thumbnail,
        url: data.stream_url,
        source: 'youtube',
        youtubeId: item.youtube_id,
        channelName: item.channel,
        thumbnailUrl: item.thumbnail,
      };

      await TrackPlayer.reset();
      await TrackPlayer.add(track);
      await TrackPlayer.play();

      usePlayerStore.setState({
        currentTrack: track,
        queue: [track],
        isPlaying: true,
      });

      navigation.getParent()?.navigate('NowPlaying');
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Could not start playback',
      });
    } finally {
      setIsRowLoading(null);
    }
  };

  const handleOpenMenu = (item: YouTubeSearchResult) => {
    setSelectedResult(item);
    menuSheetRef.current?.present();
  };

  const handleLike = async () => {
    if (!selectedResult) {
      return;
    }
    try {
      const songId = await ensureSongInCatalogue({
        youtube_id: selectedResult.youtube_id,
        title: selectedResult.title,
        channel_name: selectedResult.channel,
        thumbnail_url: selectedResult.thumbnail,
        duration_sec: selectedResult.duration,
      });
      await apiClient.post('/liked', { song_id: songId });
      Toast.show({ type: 'success', text1: 'Added to liked songs' });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not like song' });
    }
  };

  const handleAddToQueue = async () => {
    if (!selectedResult) {
      return;
    }
    try {
      const songId = await ensureSongInCatalogue({
        youtube_id: selectedResult.youtube_id,
        title: selectedResult.title,
        channel_name: selectedResult.channel,
        thumbnail_url: selectedResult.thumbnail,
        duration_sec: selectedResult.duration,
      });
      const { data } = await apiClient.get<{ stream_url: string }>('/youtube/stream', {
        params: { id: selectedResult.youtube_id },
      });
      const track: Track = {
        id: songId,
        title: selectedResult.title,
        artist: selectedResult.channel,
        album: 'YouTube',
        artwork: selectedResult.thumbnail,
        url: data.stream_url,
        source: 'youtube',
        youtubeId: selectedResult.youtube_id,
        channelName: selectedResult.channel,
        thumbnailUrl: selectedResult.thumbnail,
      };
      await addToQueue(track);
      Toast.show({ type: 'success', text1: 'Added to queue' });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not add to queue' });
    }
  };

  const loadPlaylists = async () => {
    setIsLoadingPlaylists(true);
    try {
      const { data } = await apiClient.get<Array<{ id: string; name: string }>>('/playlists');
      const detailed = await Promise.all(
        data.map(async (playlist) => {
          const detail = await apiClient.get<PlaylistRecord>(`/playlists/${playlist.id}`);
          return detail.data;
        })
      );
      setPlaylists(detailed);
    } catch {
      Toast.show({ type: 'error', text1: 'Could not load playlists' });
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  const handleOpenPlaylistSheet = async () => {
    menuSheetRef.current?.dismiss();
    playlistSheetRef.current?.present();
    if (playlists.length === 0) {
      await loadPlaylists();
    }
  };

  const handleAddToPlaylist = async (playlist: PlaylistRecord) => {
    if (!selectedResult) {
      return;
    }
    try {
      const songId = await ensureSongInCatalogue({
        youtube_id: selectedResult.youtube_id,
        title: selectedResult.title,
        channel_name: selectedResult.channel,
        thumbnail_url: selectedResult.thumbnail,
        duration_sec: selectedResult.duration,
      });
      await apiClient.post(`/playlists/${playlist.id}/songs`, { song_id: songId });
      Toast.show({ type: 'success', text1: `Added to ${playlist.name}` });
      playlistSheetRef.current?.dismiss();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not add to playlist' });
    }
  };

  const handleShare = () => {
    if (!selectedResult) {
      return;
    }
    Linking.openURL(`https://www.youtube.com/watch?v=${selectedResult.youtube_id}`);
  };

  const handleGenrePress = (genre: string) => {
    setSearchText(genre);
    setDebouncedQuery(genre);
  };

  const renderResultItem = ({ item }: { item: YouTubeSearchResult }) => {
    const isActive = item.youtube_id === currentTrack?.youtubeId || item.youtube_id === currentTrack?.youtube_id;
    const isLoadingRow = isRowLoading === item.youtube_id;

    return (
      <Pressable style={styles.resultRow} onPress={() => void handlePlayResult(item)}>
        <Image source={{ uri: item.thumbnail }} style={styles.resultThumb} contentFit="cover" />
        <View style={styles.resultMeta}>
          <Text numberOfLines={1} style={styles.resultTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.resultSubtitle}>
            {item.channel}
          </Text>
        </View>
        <Text style={styles.resultDuration}>{formatTime(item.duration)}</Text>
        {isLoadingRow ? (
          <ActivityIndicator color={Colors.primary} style={styles.resultAction} />
        ) : (
          <Pressable onPress={() => handleOpenMenu(item)} style={styles.resultAction}>
            <Ionicons name="ellipsis-horizontal" size={20} color={Colors.onBackground} />
          </Pressable>
        )}
        {isActive ? <View style={styles.activeDot} /> : null}
      </Pressable>
    );
  };

  const renderGenreCard = ({ item }: { item: (typeof GENRE_CARDS)[number] }) => (
    <Pressable style={[styles.genreCard, { backgroundColor: item.color }]} onPress={() => handleGenrePress(item.label)}>
      <Ionicons name="musical-notes" size={20} color="#141414" />
      <Text style={styles.genreCardText}>{item.label}</Text>
    </Pressable>
  );

  const renderPlaylistItem = ({ item }: { item: PlaylistRecord }) => (
    <Pressable onPress={() => void handleAddToPlaylist(item)} style={styles.sheetRow}>
      <View>
        <Text style={styles.sheetRowTitle}>{item.name}</Text>
        <Text style={styles.sheetRowSubtitle}>{item.songs?.length ?? 0} songs</Text>
      </View>
      <Ionicons name="add-circle-outline" size={20} color={Colors.onBackground} />
    </Pressable>
  );

  const showDefaultState = searchText.trim().length === 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search songs, artists, genres"
          placeholderTextColor={Colors.muted}
          style={styles.input}
        />
      </View>

      {showDefaultState ? (
        <FlashList
          data={GENRE_CARDS}
          numColumns={3}
          keyExtractor={(item) => item.label}
          estimatedItemSize={120}
          contentContainerStyle={styles.genreGrid}
          renderItem={renderGenreCard}
        />
      ) : (
        <View style={styles.resultsContainer}>
          {isLoading || isFetching ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : null}

          <FlashList
            data={results ?? []}
            keyExtractor={(item) => item.youtube_id}
            estimatedItemSize={88}
            renderItem={renderResultItem}
            contentContainerStyle={styles.resultsList}
            ListEmptyComponent={
              debouncedQuery.length >= MIN_SEARCH_CHARS && !isLoading ? (
                <Text style={styles.emptyText}>No results for "{debouncedQuery}".</Text>
              ) : null
            }
          />
        </View>
      )}

      <BottomSheetModal
        ref={menuSheetRef}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetView style={styles.sheetContainer}>
          <Text style={styles.sheetTitle}>{selectedResult?.title ?? 'Song actions'}</Text>
          <Pressable style={styles.sheetAction} onPress={() => void handleLike()}>
            <Ionicons name="heart-outline" size={20} color={Colors.onBackground} />
            <Text style={styles.sheetActionText}>Like</Text>
          </Pressable>
          <Pressable style={styles.sheetAction} onPress={() => void handleAddToQueue()}>
            <Ionicons name="add-outline" size={20} color={Colors.onBackground} />
            <Text style={styles.sheetActionText}>Add to Queue</Text>
          </Pressable>
          <Pressable style={styles.sheetAction} onPress={() => void handleOpenPlaylistSheet()}>
            <Ionicons name="musical-notes-outline" size={20} color={Colors.onBackground} />
            <Text style={styles.sheetActionText}>Add to Playlist</Text>
          </Pressable>
          <Pressable style={styles.sheetAction} onPress={handleShare}>
            <Ionicons name="share-social-outline" size={20} color={Colors.onBackground} />
            <Text style={styles.sheetActionText}>Share</Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        ref={playlistSheetRef}
        snapPoints={playlistSnapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetView style={styles.sheetContainer}>
          <Text style={styles.sheetTitle}>Add To Playlist</Text>
          <BottomSheetFlatList
            data={playlists}
            keyExtractor={(item) => item.id}
            renderItem={renderPlaylistItem}
            ListEmptyComponent={
              <Text style={styles.sheetEmptyText}>
                {isLoadingPlaylists ? 'Loading playlists...' : 'No playlists available.'}
              </Text>
            }
          />
        </BottomSheetView>
      </BottomSheetModal>
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
    paddingBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  genreGrid: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  genreCard: {
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
    flex: 1,
    marginBottom: Spacing.md,
    marginHorizontal: Spacing.xs,
    minHeight: 96,
    justifyContent: 'center',
    gap: 8,
  },
  genreCardText: {
    color: '#141414',
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightBold,
    textAlign: 'center',
  },
  resultsContainer: {
    flex: 1,
  },
  loadingState: {
    paddingVertical: Spacing.md,
  },
  resultsList: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 140,
  },
  resultRow: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    flexDirection: 'row',
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  resultThumb: {
    borderRadius: BorderRadius.sm,
    height: 56,
    width: 56,
  },
  resultMeta: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  resultTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
  },
  resultSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 2,
  },
  resultDuration: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginRight: Spacing.sm,
  },
  resultAction: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  activeDot: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.full,
    height: 6,
    marginLeft: Spacing.xs,
    width: 6,
  },
  emptyText: {
    color: Colors.muted,
    fontSize: Typography.fontSizeMd,
    paddingVertical: Spacing.md,
    textAlign: 'center',
  },
  sheetBackground: {
    backgroundColor: Colors.surface,
  },
  sheetHandle: {
    backgroundColor: Colors.muted,
  },
  sheetContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  sheetTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    marginBottom: Spacing.md,
  },
  sheetAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sheetActionText: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
  },
  sheetRow: {
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  sheetRowTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemiBold,
  },
  sheetRowSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 2,
  },
  sheetEmptyText: {
    color: Colors.muted,
    fontSize: Typography.fontSizeMd,
    paddingTop: Spacing.md,
    textAlign: 'center',
  },
});
