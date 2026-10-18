import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
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
import Animated, {
  FadeInDown,
  FadeInUp,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import * as playback from '../services/playbackController';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import { useBottomPadding } from '../hooks/useBottomPadding';
import { useSettingsStore } from '../store/settingsStore';
import { openSongMenu } from '../store/songMenuStore';
import SongRow from '../components/SongRow';
import SkeletonLoader from '../components/SkeletonLoader';
import { tapHaptic } from '../services/haptics';
import { Colors, Motion, TypeScale } from '../constants/theme';

type Props = BottomTabScreenProps<BottomTabParamList, 'Search'>;

type GenreCard = { label: string; colors: string[]; overlay?: boolean };
type ResultFilter = 'all' | 'songs' | 'channels';

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
const FILTERS: Array<{ key: ResultFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'songs', label: 'Songs' },
  { key: 'channels', label: 'Channels' },
];
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARS = 2;
const CONTENT_PADDING = 16;
const GENRE_CARD_GAP = 12;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GENRE_CARD_SIZE = (SCREEN_WIDTH - CONTENT_PADDING * 2 - GENRE_CARD_GAP) / 2;

function AnimatedGenreCard({ item, onPress }: { item: GenreCard; onPress: () => void }) {
  const pressVal = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressVal.value, [0, 1], [Motion.pressScale, 1]) }],
  }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={styles.genreCard}
        onPress={onPress}
        onPressIn={() => { pressVal.value = withTiming(0, { duration: Motion.duration.fast }); }}
        onPressOut={() => { pressVal.value = withTiming(1, { duration: Motion.duration.quick }); }}
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
      </Pressable>
    </Animated.View>
  );
}

export default function SearchScreen({ route, navigation }: Props) {
  const [searchText, setSearchText] = useState(route.params?.initialQuery ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ResultFilter>('all');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recentSearches = useSettingsStore((s) => s.recentSearches);
  const addRecentSearch = useSettingsStore((s) => s.addRecentSearch);
  const removeRecentSearch = useSettingsStore((s) => s.removeRecentSearch);
  const clearRecentSearches = useSettingsStore((s) => s.clearRecentSearches);

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

  useEffect(() => {
    setFilter('all');
  }, [debouncedQuery]);

  const { data: results, isLoading, isFetching } = useQuery({
    queryKey: ['youtube-search', debouncedQuery],
    enabled: debouncedQuery.length >= MIN_SEARCH_CHARS,
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<playback.YouTubeResult[]>('/youtube/search', {
        params: { q: debouncedQuery, limit: 20 },
        signal,
      });
      return data;
    },
  });

  const songs = useMemo(() => (results ?? []).map(playback.fromYouTube), [results]);

  // Channels that appear in the results, most frequent first.
  const channels = useMemo(() => {
    const counts = new Map<string, { count: number; thumbnail: string | null | undefined }>();
    songs.forEach((s) => {
      if (!s.channel_name) return;
      const entry = counts.get(s.channel_name);
      counts.set(s.channel_name, { count: (entry?.count ?? 0) + 1, thumbnail: entry?.thumbnail ?? s.thumbnail_url });
    });
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count).map(([name, v]) => ({ name, ...v }));
  }, [songs]);

  const handlePlay = async (song: playback.SongInput) => {
    if (loadingId) return;
    setLoadingId(song.youtube_id);
    addRecentSearch(debouncedQuery || searchText);
    try {
      // Spotify-style: play the song, then Autoplay continues with similar music.
      await playback.playSongs([song], 0, { type: 'search', name: `“${debouncedQuery}”` });
      navigation.getParent()?.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not start playback', text2: 'Stream unavailable — try another song' });
    } finally {
      setLoadingId(null);
    }
  };

  const openChannel = (channelName: string) => {
    addRecentSearch(debouncedQuery || searchText);
    navigation.getParent()?.navigate('Channel', { channelName });
  };

  const applyQuery = (query: string) => {
    tapHaptic();
    setSearchText(query);
    setDebouncedQuery(query);
  };

  const bottomPadding = useBottomPadding();

  const showDefaultState = searchText.trim().length < MIN_SEARCH_CHARS;
  const showNoResults =
    !showDefaultState && !isLoading && !isFetching && results !== undefined && results.length === 0;

  const hasAnimated = useRef(false);
  useEffect(() => { hasAnimated.current = true; }, []);
  const entering = !hasAnimated.current;

  const topResult = songs[0];

  const resultsHeader = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => {
              tapHaptic();
              setFilter(f.key);
            }}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {filter === 'all' && topResult ? (
        <>
          <Text style={styles.sectionHeader}>Top result</Text>
          <Pressable
            onPress={() => void handlePlay(topResult)}
            onLongPress={() => openSongMenu(topResult)}
            style={({ pressed }) => [styles.topCard, pressed && styles.cardPressed]}
          >
            <Image source={{ uri: topResult.thumbnail_url ?? undefined }} style={styles.topThumb} contentFit="cover" />
            <Text numberOfLines={2} style={styles.topTitle}>{topResult.title}</Text>
            <Text numberOfLines={1} style={styles.topMeta}>Song · {topResult.channel_name}</Text>
            <View style={styles.topPlay}>
              {loadingId === topResult.youtube_id ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons name="play" size={22} color="#FFFFFF" style={{ marginLeft: 2 }} />
              )}
            </View>
          </Pressable>

          {channels.length > 0 ? (
            <>
              <Text style={styles.sectionHeader}>Channels</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelStrip}>
                {channels.slice(0, 8).map((channel) => (
                  <Pressable key={channel.name} onPress={() => openChannel(channel.name)} style={styles.channelTile}>
                    <Image source={{ uri: channel.thumbnail ?? undefined }} style={styles.channelTileImage} contentFit="cover" />
                    <Text numberOfLines={2} style={styles.channelTileName}>{channel.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          <Text style={styles.sectionHeader}>Songs</Text>
        </>
      ) : null}
    </View>
  );

  const recentHeader =
    recentSearches.length > 0 ? (
      <View style={styles.recentSection}>
        <View style={styles.recentHeaderRow}>
          <Text style={styles.recentTitle}>Recent searches</Text>
          <Pressable onPress={clearRecentSearches} hitSlop={8}>
            <Text style={styles.recentClear}>Clear</Text>
          </Pressable>
        </View>
        {recentSearches.slice(0, 6).map((recent) => (
          <Pressable key={recent.query} onPress={() => applyQuery(recent.query)} style={styles.recentRow}>
            <Ionicons name="time-outline" size={20} color={Colors.textMuted} />
            <Text numberOfLines={1} style={styles.recentText}>{recent.query}</Text>
            <Pressable onPress={() => removeRecentSearch(recent.query)} hitSlop={10} accessibilityLabel={`Remove ${recent.query}`}>
              <Ionicons name="close" size={18} color={Colors.textMuted} />
            </Pressable>
          </Pressable>
        ))}
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Search bar ── */}
      <Animated.View entering={entering ? FadeInDown.duration(Motion.duration.enter) : undefined} style={styles.header}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} style={styles.searchIcon} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={() => addRecentSearch(searchText)}
            placeholder="Songs, artists, channels"
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => setSearchText('')} hitSlop={8} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
      </Animated.View>

      {showDefaultState ? (
        /* ── Default: recent searches + genre grid ── */
        <Animated.View entering={entering ? FadeInUp.delay(60).duration(Motion.duration.enter) : undefined} style={{ flex: 1 }}>
          <FlatList
            data={GENRE_CARDS}
            numColumns={2}
            keyExtractor={(item) => item.label}
            columnWrapperStyle={styles.genreRow}
            contentContainerStyle={[styles.genreGrid, { paddingBottom: bottomPadding }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <>
                {recentHeader}
                <Text style={styles.browseHeader}>Browse all</Text>
              </>
            }
            renderItem={({ item }) => <AnimatedGenreCard item={item} onPress={() => applyQuery(item.label)} />}
          />
        </Animated.View>
      ) : showNoResults ? (
        /* ── No results ── */
        <ScrollView
          contentContainerStyle={[styles.noResultsContent, { paddingBottom: bottomPadding }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.noResultsIconWrap}>
            <View style={styles.noResultsGlow} />
            <Ionicons name="search-outline" size={88} color="rgba(255,255,255,0.12)" />
          </View>
          <Text style={styles.noResultsTitle}>Couldn't find "{debouncedQuery}"</Text>
          <Text style={styles.noResultsSubtitle}>
            Try searching again using a different spelling or keyword.
          </Text>
          <View style={styles.suggestedSection}>
            <Text style={styles.suggestedLabel}>SUGGESTED</Text>
            <View style={styles.suggestedTags}>
              {SUGGESTED_TAGS.map((tag) => (
                <Pressable
                  key={tag}
                  style={({ pressed }) => [styles.suggestedTag, pressed && styles.cardPressed]}
                  onPress={() => applyQuery(tag)}
                >
                  <Text style={styles.suggestedTagText}>{tag}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      ) : isLoading && !results ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.resultSkeletonRow}>
              <SkeletonLoader width={48} height={48} borderRadius={4} />
              <View style={styles.skeletonMeta}>
                <SkeletonLoader width="70%" height={14} borderRadius={4} />
                <SkeletonLoader width="45%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
              </View>
            </View>
          ))}
        </View>
      ) : filter === 'channels' ? (
        <FlashList
          data={channels}
          keyExtractor={(item) => item.name}
          ListHeaderComponent={resultsHeader}
          contentContainerStyle={{ paddingBottom: bottomPadding }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable onPress={() => openChannel(item.name)} style={({ pressed }) => [styles.channelRow, pressed && styles.rowPressed]}>
              <Image source={{ uri: item.thumbnail ?? undefined }} style={styles.channelRowImage} contentFit="cover" />
              <View style={styles.channelRowMeta}>
                <Text numberOfLines={1} style={styles.channelRowName}>{item.name}</Text>
                <Text style={styles.channelRowSub}>Channel · {item.count} {item.count === 1 ? 'result' : 'results'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.resultsWrap}>
          {isFetching && (
            <View style={styles.fetchingRow}>
              <ActivityIndicator color={Colors.primary} size="small" />
            </View>
          )}
          <FlashList
            data={filter === 'all' ? songs.slice(1) : songs}
            keyExtractor={(item) => item.youtube_id}
            ListHeaderComponent={resultsHeader}
            contentContainerStyle={{ paddingBottom: bottomPadding }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <SongRow song={item} isLoading={loadingId === item.youtube_id} onPress={() => void handlePlay(item)} />
            )}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: Colors.background, flex: 1 },

  // ── Search bar ──
  header: {
    paddingBottom: 12,
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 12,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    flexDirection: 'row',
    height: 44,
    paddingHorizontal: 14,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: TypeScale.body,
  },
  clearBtn: { marginLeft: 6 },

  // ── Recent searches ──
  recentSection: {
    marginBottom: 16,
  },
  recentHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  recentTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    fontWeight: '700',
  },
  recentClear: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  recentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  recentText: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: TypeScale.body,
  },

  // ── Browse / genre grid ──
  genreGrid: { paddingHorizontal: CONTENT_PADDING },
  genreRow: { gap: GENRE_CARD_GAP },
  browseHeader: {
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
    marginBottom: 16,
    marginTop: 8,
  },
  genreCard: {
    borderRadius: 12,
    height: GENRE_CARD_SIZE * 0.6,
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
    fontSize: TypeScale.large,
    fontWeight: '700',
    left: 12,
    position: 'absolute',
    top: 12,
  },

  // ── Result filters ──
  filterRow: {
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: CONTENT_PADDING,
  },
  filterChip: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
  },
  filterChipText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  sectionHeader: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 16,
    paddingHorizontal: CONTENT_PADDING,
  },
  topCard: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    marginHorizontal: CONTENT_PADDING,
    padding: 16,
  },
  topThumb: {
    borderRadius: 8,
    height: 92,
    marginBottom: 16,
    width: 92,
  },
  topTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
    marginRight: 56,
  },
  topMeta: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 4,
  },
  topPlay: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    bottom: 16,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    width: 48,
  },
  channelStrip: {
    gap: 16,
    paddingHorizontal: CONTENT_PADDING,
  },
  channelTile: {
    alignItems: 'center',
    width: 104,
  },
  channelTileImage: {
    borderRadius: 999,
    height: 96,
    width: 96,
  },
  channelTileName: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  channelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: CONTENT_PADDING,
    paddingVertical: 8,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  channelRowImage: {
    borderRadius: 999,
    height: 56,
    width: 56,
  },
  channelRowMeta: {
    flex: 1,
    minWidth: 0,
  },
  channelRowName: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
    fontWeight: '600',
  },
  channelRowSub: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
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
    fontSize: TypeScale.title,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  noResultsSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    lineHeight: 20,
    marginBottom: 36,
    textAlign: 'center',
  },
  suggestedSection: { alignItems: 'center', width: '100%' },
  suggestedLabel: {
    color: Colors.textMuted,
    fontSize: TypeScale.caption,
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
    backgroundColor: Colors.surface,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  suggestedTagText: { color: '#FFFFFF', fontSize: TypeScale.small, fontWeight: '500' },

  // ── Results state ──
  resultsWrap: { flex: 1 },
  fetchingRow: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  skeletonList: {
    gap: 12,
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 8,
  },
  resultSkeletonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  skeletonMeta: {
    flex: 1,
  },
  cardPressed: { transform: [{ scale: Motion.pressScale }] },
});
