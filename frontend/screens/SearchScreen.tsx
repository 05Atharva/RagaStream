import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import AnimatedBottomSheet from '../components/AnimatedBottomSheet';
import PressableCard from '../components/PressableCard';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { playTrack } from '../services/audioPlayer';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import { queryClient } from '../services/queryClient';
import { ensureSongInCatalogue } from '../services/songService';
import { recordPlayHistory } from '../services/historyService';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import { usePlayerStore, type Track } from '../store/playerStore';
import { useBottomPadding } from '../hooks/useBottomPadding';
import SongOptionsSheet from '../components/SongOptionsSheet';
import SkeletonLoader from '../components/SkeletonLoader';

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

type GenreCard = { label: string; colors: string[]; overlay?: boolean };

const GENRE_CARDS: GenreCard[] = [
  { label: 'Bollywood', colors: ['#FF416C', '#FF4B2B'] },
  { label: 'Classical', colors: ['#4776E6', '#8E54E9'] },
  { label: 'Folk', colors: ['#11998e', '#38ef7d'] },
  { label: 'Devotional', colors: ['#F2994A', '#F2C94C'] },
  { label: 'Indie', colors: ['#8E2DE2', '#4A00E0'] },
  { label: 'Punjabi', colors: ['#b20a2c', '#fffbd5'], overlay: true },
  { label: 'Ghazals', colors: ['#0F2027', '#203A43', '#2C5364'] },
  { label: 'Sufi', colors: ['#1c92d2', '#f2fcfe'], overlay: true },
  { label: 'Trending', colors: ['#ED213A', '#93291E'] },
];

const SUGGESTED_TAGS = ['Classical Fusion', 'Morning Raags', 'Sitar Covers'];
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARS = 2;
const CONTENT_PADDING = 20;
const GENRE_CARD_GAP = 12;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GENRE_CARD_SIZE = (SCREEN_WIDTH - CONTENT_PADDING * 2 - GENRE_CARD_GAP) / 2;

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
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
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isPlaylistVisible, setIsPlaylistVisible] = useState(false);

  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const addToQueue = usePlayerStore((state) => state.addToQueue);

  useEffect(() => {
    if (route.params?.initialQuery) {
      setSearchText(route.params.initialQuery);
      setDebouncedQuery(route.params.initialQuery);
    }
  }, [route.params?.initialQuery]);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const trimmed = searchText.trim();
    if (trimmed.length < MIN_SEARCH_CHARS) {
      setDebouncedQuery('');
      return;
    }
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchText]);

  const { data: results, isLoading, isFetching } = useQuery({
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

  const likedQuery = useQuery({
    queryKey: ['liked'],
    queryFn: async () => {
      const { data } = await apiClient.get<SongRecord[]>('/liked');
      return data;
    },
  });

  const selectedLikedSong = useMemo(() => {
    if (!selectedResult) {
      return undefined;
    }

    return likedQuery.data?.find((song) => song.youtube_id === selectedResult.youtube_id);
  }, [likedQuery.data, selectedResult]);

  const selectedIsLiked = Boolean(selectedLikedSong);


  const handlePlayResult = async (item: YouTubeSearchResult) => {
    if (isRowLoading) return;
    setIsRowLoading(item.youtube_id);
    const cataloguePromise = ensureSongInCatalogue({
      youtube_id: item.youtube_id,
      title: item.title,
      channel_name: item.channel,
      thumbnail_url: item.thumbnail,
      duration_sec: item.duration,
    }).catch(() => item.youtube_id);
    try {
      const { data } = await apiClient.get<{ stream_url: string }>('/youtube/stream', {
        params: { id: item.youtube_id },
      });
      const songId = await cataloguePromise;
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
      await playTrack(track);
      usePlayerStore.setState({ currentTrack: track, queue: [track], isPlaying: true });
      void recordPlayHistory(songId).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['history'] });
      });
      navigation.getParent()?.navigate('NowPlaying');
    } catch (err) {
      console.error('[SearchScreen] playback error:', err);
      Toast.show({ type: 'error', text1: 'Could not start playback', text2: 'Stream unavailable — try another song' });
    } finally {
      setIsRowLoading(null);
    }
  };

  const handleOpenMenu = (item: YouTubeSearchResult) => {
    setSelectedResult(item);
    setIsMenuVisible(true);
  };

  const handleLike = async () => {
    if (!selectedResult) return;

    const wasLiked = selectedIsLiked;
    const previousLikedSongs = queryClient.getQueryData<SongRecord[]>(['liked']);
    const optimisticSong: SongRecord = selectedLikedSong ?? {
      id: selectedResult.youtube_id,
      youtube_id: selectedResult.youtube_id,
      title: selectedResult.title,
      channel_name: selectedResult.channel,
      thumbnail_url: selectedResult.thumbnail,
      duration_sec: selectedResult.duration,
    };

    queryClient.setQueryData<SongRecord[]>(['liked'], (current = []) => {
      if (wasLiked) {
        return current.filter((song) => song.youtube_id !== selectedResult.youtube_id);
      }

      if (current.some((song) => song.youtube_id === selectedResult.youtube_id)) {
        return current;
      }

      return [optimisticSong, ...current];
    });

    try {
      const songId = selectedLikedSong?.id ?? await ensureSongInCatalogue({
        youtube_id: selectedResult.youtube_id,
        title: selectedResult.title,
        channel_name: selectedResult.channel,
        thumbnail_url: selectedResult.thumbnail,
        duration_sec: selectedResult.duration,
      });

      if (wasLiked) {
        await apiClient.delete(`/liked/${songId}`);
        Toast.show({ type: 'success', text1: 'Removed from liked songs' });
      } else {
        await apiClient.post('/liked', { song_id: songId });
        Toast.show({ type: 'success', text1: 'Added to liked songs' });
      }

      void queryClient.invalidateQueries({ queryKey: ['liked'] });
    } catch {
      queryClient.setQueryData(['liked'], previousLikedSongs);
      Toast.show({ type: 'error', text1: 'Could not update liked songs' });
    }
  };

  const handleAddToQueue = async () => {
    if (!selectedResult) return;
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
    setIsMenuVisible(false);
    setIsPlaylistVisible(true);
    if (playlists.length === 0) await loadPlaylists();
  };

  const handleAddToPlaylist = async (playlist: PlaylistRecord) => {
    if (!selectedResult) return;
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
      setIsPlaylistVisible(false);
    } catch {
      Toast.show({ type: 'error', text1: 'Could not add to playlist' });
    }
  };

  const handleShare = () => {
    if (!selectedResult) return;
    Linking.openURL(`https://www.youtube.com/watch?v=${selectedResult.youtube_id}`);
  };

  const handleGenrePress = (genre: string) => {
    setSearchText(genre);
    setDebouncedQuery(genre);
  };

  const renderGenreCard = ({ item }: { item: GenreCard }) => (
    <PressableCard
      style={styles.genreCard}
      onPress={() => handleGenrePress(item.label)}
    >
      <LinearGradient
        colors={item.colors as [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.genreGradient}
      >
        {item.overlay && <View style={styles.cardOverlay} />}
        <Text style={styles.genreCardLabel}>{item.label}</Text>
      </LinearGradient>
    </PressableCard>
  );

  const renderResultItem = ({ item }: { item: YouTubeSearchResult }) => {
    const isActive =
      item.youtube_id === currentTrack?.youtubeId ||
      item.youtube_id === (currentTrack as Record<string, unknown>)?.youtube_id;
    const isLoadingRow = isRowLoading === item.youtube_id;
    return (
      <Pressable
        style={({ pressed }) => [styles.resultRow, pressed && styles.cardPressed]}
        onPress={() => void handlePlayResult(item)}
      >
        <View style={styles.resultThumbWrap}>
          <Image source={{ uri: item.thumbnail }} style={styles.resultThumb} contentFit="cover" />
          {isLoadingRow && (
            <View style={styles.thumbSpinner}>
              <ActivityIndicator color="#7C3AED" size="small" />
            </View>
          )}
        </View>
        <View style={styles.resultMeta}>
          <Text numberOfLines={1} style={[styles.resultTitle, isActive && styles.resultTitleActive]}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.resultSubtitle}>
            {item.channel} · {formatTime(item.duration)}
          </Text>
        </View>
        <Pressable onPress={() => handleOpenMenu(item)} style={styles.menuBtn} hitSlop={10}>
          <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.45)" />
        </Pressable>
      </Pressable>
    );
  };

  const renderPlaylistItem = ({ item }: { item: PlaylistRecord }) => (
    <Pressable
      onPress={() => void handleAddToPlaylist(item)}
      style={({ pressed }) => [styles.playlistRow, pressed && styles.cardPressed]}
    >
      <View style={styles.playlistRowText}>
        <Text style={styles.playlistRowTitle}>{item.name}</Text>
        <Text style={styles.playlistRowSubtitle}>{item.songs?.length ?? 0} songs</Text>
      </View>
      <Ionicons name="add-circle-outline" size={22} color="rgba(255,255,255,0.7)" />
    </Pressable>
  );

  const bottomPadding = useBottomPadding();

  const showDefaultState = searchText.trim().length < MIN_SEARCH_CHARS;
  const showNoResults =
    !showDefaultState &&
    !isLoading &&
    !isFetching &&
    results !== undefined &&
    results.length === 0;

  const hasAnimated = useRef(false);
  useEffect(() => { hasAnimated.current = true; }, []);
  const entering = !hasAnimated.current;

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Search bar ── */}
      <Animated.View entering={entering ? FadeInDown.delay(0).duration(300) : undefined} style={styles.header}>
        <View style={styles.searchBar}>
          <Ionicons
            name="search-outline"
            size={18}
            color="rgba(255,255,255,0.45)"
            style={styles.searchIcon}
          />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search songs, artists, genres"
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => setSearchText('')} hitSlop={8} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.45)" />
            </Pressable>
          )}
        </View>
      </Animated.View>

      {/* ── State: Default — gradient genre grid ── */}
      {showDefaultState ? (
        <Animated.View entering={entering ? FadeInUp.delay(60).duration(350) : undefined} style={{ flex: 1 }}>
        <FlatList
          data={GENRE_CARDS}
          numColumns={2}
          keyExtractor={(item) => item.label}
          columnWrapperStyle={styles.genreRow}
          contentContainerStyle={[styles.genreGrid, { paddingBottom: bottomPadding }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<Text style={styles.browseHeader}>Browse all</Text>}
          renderItem={renderGenreCard}
        />
        </Animated.View>
      ) : showNoResults ? (
        /* ── State: No results — centered empty layout ── */
        <ScrollView
          contentContainerStyle={[styles.noResultsContent, { paddingBottom: bottomPadding }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.noResultsIconWrap}>
            <View style={styles.noResultsGlow} />
            <Ionicons name="search-outline" size={88} color="rgba(255,255,255,0.12)" />
          </View>
          <Text style={styles.noResultsTitle}>No results for "{debouncedQuery}"</Text>
          <Text style={styles.noResultsSubtitle}>
            Try a different search term or explore our curated playlists.
          </Text>
          <View style={styles.suggestedSection}>
            <Text style={styles.suggestedLabel}>SUGGESTED TAGS</Text>
            <View style={styles.suggestedTags}>
              {SUGGESTED_TAGS.map((tag) => (
                <Pressable
                  key={tag}
                  style={({ pressed }) => [styles.suggestedTag, pressed && styles.cardPressed]}
                  onPress={() => handleGenrePress(tag)}
                >
                  <Text style={styles.suggestedTagText}>{tag}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      ) : (
        /* ── State: Results list ── */
        isLoading && !results ? (
          <View style={styles.skeletonList}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={styles.resultSkeletonRow}>
                <SkeletonLoader width={56} height={56} borderRadius={8} />
                <View style={styles.skeletonMeta}>
                  <SkeletonLoader width="70%" height={14} borderRadius={4} />
                  <SkeletonLoader width="45%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.resultsWrap}>
            {isFetching && (
              <View style={styles.fetchingRow}>
                <ActivityIndicator color="#7C3AED" size="small" />
              </View>
            )}
            <FlashList
              data={results ?? []}
              keyExtractor={(item) => item.youtube_id}
              renderItem={renderResultItem}
              contentContainerStyle={[styles.resultsList, { paddingBottom: bottomPadding }]}
              ListHeaderComponent={
                (results?.length ?? 0) > 0 ? (
                  <Text style={styles.resultsHeader}>Top Results</Text>
                ) : null
              }
            />
          </View>
        )
      )}

      {/* ── Song options bottom sheet ── */}
      <SongOptionsSheet
        isVisible={isMenuVisible}
        onClose={() => setIsMenuVisible(false)}
        thumbnail={selectedResult?.thumbnail}
        title={selectedResult?.title ?? ''}
        channel={selectedResult?.channel ?? ''}
        isLiked={selectedIsLiked}
        onLike={() => void handleLike()}
        onAddToPlaylist={() => void handleOpenPlaylistSheet()}
        onAddToQueue={() => void handleAddToQueue()}
        onShare={handleShare}
      />

      {/* ── Playlist picker bottom sheet ── */}
      <AnimatedBottomSheet
        isVisible={isPlaylistVisible}
        onClose={() => setIsPlaylistVisible(false)}
        backgroundColor="#121414"
      >
        <View style={styles.sheetContainer}>
          <Text style={styles.sheetPickerTitle}>Add To Playlist</Text>
          <FlatList
            data={playlists}
            keyExtractor={(item) => item.id}
            renderItem={renderPlaylistItem}
            ListEmptyComponent={
              <Text style={styles.sheetEmptyText}>
                {isLoadingPlaylists ? 'Loading playlists...' : 'No playlists available.'}
              </Text>
            }
          />
        </View>
      </AnimatedBottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#000000', flex: 1 },

  // ── Search bar ──
  header: {
    paddingBottom: 12,
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 12,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: '#282a2b',
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    height: 44,
    paddingHorizontal: 14,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 15,
  },
  clearBtn: { marginLeft: 6 },

  // ── Browse / genre grid ──
  genreGrid: { paddingHorizontal: CONTENT_PADDING },
  genreRow: { gap: GENRE_CARD_GAP },
  browseHeader: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
    marginTop: 8,
  },
  genreCard: {
    borderRadius: 12,
    height: GENRE_CARD_SIZE,
    marginBottom: GENRE_CARD_GAP,
    overflow: 'hidden',
    width: GENRE_CARD_SIZE,
  },
  genreGradient: { flex: 1 },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  genreCardLabel: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    left: 12,
    position: 'absolute',
    top: 12,
  },

  // ── No-results state ──
  noResultsContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 40,
  },
  noResultsIconWrap: {
    alignItems: 'center',
    height: 140,
    justifyContent: 'center',
    marginBottom: 28,
    width: 140,
  },
  noResultsGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderRadius: 999,
  },
  noResultsTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  noResultsSubtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 36,
    textAlign: 'center',
  },
  suggestedSection: { alignItems: 'center', width: '100%' },
  suggestedLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: 14,
    textAlign: 'center',
  },
  suggestedTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  suggestedTag: {
    backgroundColor: '#1a1c1c',
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  suggestedTagText: { color: '#e2e2e2', fontSize: 14, fontWeight: '500' },

  // ── Results state ──
  resultsWrap: { flex: 1 },
  fetchingRow: {
    alignItems: 'center',
    paddingHorizontal: CONTENT_PADDING,
    paddingVertical: 8,
  },
  resultsList: { paddingHorizontal: CONTENT_PADDING },
  resultsHeader: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 8,
  },
  resultRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  resultThumbWrap: {
    borderRadius: 8,
    flexShrink: 0,
    height: 56,
    overflow: 'hidden',
    width: 56,
  },
  resultThumb: { height: 56, width: 56 },
  thumbSpinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
  },
  resultMeta: { flex: 1, minWidth: 0 },
  resultTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  resultTitleActive: { color: '#7C3AED' },
  resultSubtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  menuBtn: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },

  // ── Bottom sheets ──
  sheetContainer: { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  sheetPickerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  playlistRow: {
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  playlistRowText: { flex: 1 },
  playlistRowTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  playlistRowSubtitle: { color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 2 },
  sheetEmptyText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 15,
    paddingTop: 16,
    textAlign: 'center',
  },

  // ── Skeleton ──
  skeletonList: {
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  resultSkeletonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  skeletonMeta: {
    flex: 1,
  },

  // ── Shared ──
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
});
