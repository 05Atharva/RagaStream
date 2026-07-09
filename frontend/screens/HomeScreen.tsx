import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  type DimensionValue,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../services/queryClient';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import Toast from 'react-native-toast-message';
import { apiClient } from '../services/apiClient';
import { playTrack } from '../services/audioPlayer';
import { ensureSongInCatalogue } from '../services/songService';
import { recordPlayHistory } from '../services/historyService';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import type { Song } from '../hooks/useSongs';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../services/supabase';
import { useBottomPadding } from '../hooks/useBottomPadding';
import { usePlayerStore, type Track } from '../store/playerStore';

type Props = BottomTabScreenProps<BottomTabParamList, 'Home'>;

type YouTubeStreamData = {
  stream_url: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
};

const GENRE_CHIPS = [
  { label: 'Bollywood', color: '#FF6B6B' },
  { label: 'Classical', color: '#4ECDC4' },
  { label: 'Folk', color: '#45B7D1' },
  { label: 'Devotional', color: '#FFA07A' },
  { label: 'Indie', color: '#98D8C8' },
  { label: 'Punjabi', color: '#FFD93D' },
  { label: 'Ghazals', color: '#C084FC' },
  { label: 'Sufi', color: '#86EFAC' },
] as const;

// PRD §7.1: "4 hardcoded youtube_ids shown as large banner cards"
const FEATURED_IDS = [
  '81qmmlsIE3k', // Tum Hi Ho - Arijit Singh (Aashiqui 2)
  'T94PHkuydcw', // Kun Faya Kun - A.R. Rahman
  '5Eqb_-j3FDA', // Pasoori - Ali Sethi x Shae Gill
  'BddP6PYo2gs', // Kesariya - Brahmāstra - Arijit Singh
];

const FEATURED_BADGES = ['NEW RELEASE', 'TOP 50', 'FEATURED', 'TRENDING'];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTENT_PADDING = 24;
// 85% of content width — shows a sliver of the next card
const FEATURED_CARD_WIDTH = (SCREEN_WIDTH - CONTENT_PADDING * 2) * 0.85;
const FEATURED_CARD_HEIGHT = 190;
const FEATURED_GAP = 12;

function getGreeting(displayName?: string | null) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const name = displayName?.trim() || 'Listener';
  return `Good ${part}, ${name}`;
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function SkeletonBlock({
  width,
  height,
  borderRadius = 16,
}: {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
}) {
  return (
    <MotiView
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.85 }}
      transition={{ type: 'timing', duration: 900, loop: true }}
      style={[styles.skeleton, { width, height, borderRadius }]}
    />
  );
}

export default function HomeScreen({ navigation }: Props) {
  const session = useAuthStore((state) => state.session);
  const displayName =
    (session?.user?.user_metadata?.name as string | undefined) ||
    (session?.user?.user_metadata?.full_name as string | undefined) ||
    session?.user?.email?.split('@')[0] ||
    'Listener';

  const historyQuery = useQuery({
    queryKey: ['history'],
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/history');
      return data.slice(0, 10);
    },
    retry: false,
    refetchOnMount: 'always',
  });

  const likedQuery = useQuery({
    queryKey: ['liked'],
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/liked');
      return data.slice(0, 6);
    },
    retry: false,
    refetchOnMount: 'always',
  });

  // Fall back to songs catalogue if liked is empty OR errored
  const shouldFallback =
    (likedQuery.isSuccess && likedQuery.data.length === 0) || likedQuery.isError;

  const fallbackQuickPicksQuery = useQuery({
    queryKey: ['songs', 'quick-picks-fallback'],
    enabled: shouldFallback,
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/songs', {
        params: { limit: 6 },
      });
      return data;
    },
    retry: false,
  });

  // PRD §7.1: Featured Today — fetch stream data for hardcoded youtube_ids
  // Individual IDs may fail (region-blocked/removed) — we skip failures silently.
  const featuredQuery = useQuery({
    queryKey: ['featured-today'],
    queryFn: async () => {
      const results = await Promise.allSettled(
        FEATURED_IDS.map(async (ytId) => {
          const { data } = await apiClient.get<YouTubeStreamData>('/youtube/stream', {
            params: { id: ytId },
          });
          return { ...data, youtube_id: ytId };
        })
      );
      // Only keep successful results
      return results
        .filter((r): r is PromiseFulfilledResult<YouTubeStreamData & { youtube_id: string }> =>
          r.status === 'fulfilled'
        )
        .map((r) => r.value);
    },
    retry: false,
  });

  const quickPicks = useMemo(() => {
    if ((likedQuery.data?.length ?? 0) > 0) {
      return likedQuery.data ?? [];
    }
    return fallbackQuickPicksQuery.data ?? [];
  }, [fallbackQuickPicksQuery.data, likedQuery.data]);

  type FeaturedCard = YouTubeStreamData & { youtube_id: string };
  const featuredCards = featuredQuery.data ?? [];

  const isQuickPicksLoading =
    likedQuery.isLoading || (shouldFallback && fallbackQuickPicksQuery.isLoading);

  const isHistoryLoading = historyQuery.isLoading;
  const isFeaturedLoading = featuredQuery.isLoading;
  const avatarLetter = displayName.charAt(0).toUpperCase();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  // UI-only state: which genre chip is highlighted
  const [selectedGenre, setSelectedGenre] = useState<string>('All');

  // Generic helper to play a YouTube track and record history
  const playYouTubeTrack = async (
    youtubeId: string,
    title: string,
    channel: string,
    thumbnail: string,
    streamUrl: string,
    album: string,
  ) => {
    const catalogueId = await ensureSongInCatalogue({
      youtube_id: youtubeId,
      title,
      channel_name: channel,
      thumbnail_url: thumbnail,
      duration_sec: 0,
    }).catch(() => youtubeId);

    const track: Track = {
      id: catalogueId,
      title,
      artist: channel,
      album,
      artwork: thumbnail,
      url: streamUrl,
      source: 'youtube',
      youtubeId,
      channelName: channel,
      thumbnailUrl: thumbnail,
    };
    await playTrack(track);
    usePlayerStore.setState({ currentTrack: track, queue: [track], isPlaying: true });
    void recordPlayHistory(catalogueId).then(() => {
      // Refresh history across all screens after recording play
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    });
    return track;
  };

  const handlePlayFeatured = async (item: FeaturedCard) => {
    if (loadingId) return;
    setLoadingId(item.youtube_id);
    try {
      await playYouTubeTrack(
        item.youtube_id,
        item.title,
        item.channel,
        item.thumbnail,
        item.stream_url,
        'Featured',
      );
      navigation.navigate('NowPlaying' as never);
    } catch (err) {
      console.error('[HomeScreen] handlePlayFeatured error:', err);
      Toast.show({ type: 'error', text1: 'Could not play this track' });
    } finally {
      setLoadingId(null);
    }
  };

  // B5 Fix: Quick Picks cards are now tappable
  const handlePlayQuickPick = async (song: Song) => {
    if (loadingId) return;
    setLoadingId(song.id);
    try {
      const { data } = await apiClient.get<YouTubeStreamData>('/youtube/stream', {
        params: { id: song.youtube_id },
      });
      await playYouTubeTrack(
        song.youtube_id,
        song.title,
        song.channel_name || 'Unknown',
        song.thumbnail_url || '',
        data.stream_url,
        'Quick Picks',
      );
      navigation.navigate('NowPlaying' as never);
    } catch {
      Toast.show({ type: 'error', text1: 'Could not play this track' });
    } finally {
      setLoadingId(null);
    }
  };

  // B6 Fix: Recently Played cards are now tappable
  const handlePlayHistory = async (song: Song) => {
    if (loadingId) return;
    setLoadingId(song.id);
    try {
      const { data } = await apiClient.get<YouTubeStreamData>('/youtube/stream', {
        params: { id: song.youtube_id },
      });
      await playYouTubeTrack(
        song.youtube_id,
        song.title,
        song.channel_name || 'Unknown',
        song.thumbnail_url || '',
        data.stream_url,
        'Recently Played',
      );
      navigation.navigate('NowPlaying' as never);
    } catch {
      Toast.show({ type: 'error', text1: 'Could not play this track' });
    } finally {
      setLoadingId(null);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase?.auth.signOut();
            } catch {
              // session already gone — App.tsx onAuthStateChange will clear it
            }
          },
        },
      ]
    );
  };

  const bottomPadding = useBottomPadding();

  const hasAnimated = useRef(false);
  useEffect(() => { hasAnimated.current = true; }, []);
  const entering = !hasAnimated.current;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <Animated.View entering={entering ? FadeInDown.delay(0).duration(400) : undefined} style={styles.header}>
          <Text style={styles.greeting}>{getGreeting(displayName)}</Text>
          <Pressable onPress={handleLogout} style={styles.avatar} hitSlop={10}>
            <Text style={styles.avatarText}>{avatarLetter}</Text>
          </Pressable>
        </Animated.View>

        {/* ── Genre filter chips (no section header) ── */}
        <Animated.View entering={entering ? FadeInDown.delay(100).duration(400) : undefined}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          <Pressable
            style={[styles.chip, selectedGenre === 'All' && styles.chipActive]}
            onPress={() => setSelectedGenre('All')}
          >
            <Text style={[styles.chipText, selectedGenre === 'All' && styles.chipTextActive]}>
              All
            </Text>
          </Pressable>
          {GENRE_CHIPS.map((chip) => (
            <Pressable
              key={chip.label}
              style={[styles.chip, selectedGenre === chip.label && styles.chipActive]}
              onPress={() => {
                setSelectedGenre(chip.label);
                navigation.navigate('Search', {
                  initialQuery: chip.label,
                  autoSearch: true,
                });
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  selectedGenre === chip.label && styles.chipTextActive,
                ]}
              >
                {chip.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        </Animated.View>

        {/* ── Featured Today — horizontal snap carousel ── */}
        <Animated.View entering={entering ? FadeInUp.delay(0).duration(350) : undefined} style={styles.section}>
          <SectionHeader title="Featured Today" />
          {isFeaturedLoading ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={false}>
              <View style={styles.featuredSkeletonRow}>
                {[0, 1].map((i) => (
                  <SkeletonBlock
                    key={i}
                    width={FEATURED_CARD_WIDTH}
                    height={FEATURED_CARD_HEIGHT}
                    borderRadius={16}
                  />
                ))}
              </View>
            </ScrollView>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={FEATURED_CARD_WIDTH + FEATURED_GAP}
              snapToAlignment="start"
              decelerationRate="fast"
              contentContainerStyle={styles.featuredScroll}
            >
              {featuredCards.map((item, index) => (
                <Pressable
                  key={item.youtube_id}
                  style={({ pressed }) => [
                    styles.featuredCard,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => void handlePlayFeatured(item)}
                >
                  <Image
                    source={item.thumbnail ? { uri: item.thumbnail } : undefined}
                    style={StyleSheet.absoluteFillObject}
                    contentFit="cover"
                  />
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.92)']}
                    locations={[0, 0.45, 1]}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View style={styles.featuredContent}>
                    <View style={styles.featuredTextGroup}>
                      <Text style={[
                        styles.featuredBadge,
                        index % 2 === 1 && styles.featuredBadgeGold,
                      ]}>
                        {FEATURED_BADGES[index] ?? 'FEATURED'}
                      </Text>
                      <Text numberOfLines={1} style={styles.featuredTitle}>
                        {item.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.featuredArtist}>
                        {item.channel}
                      </Text>
                    </View>
                    <View style={styles.featuredPlayBtn}>
                      {loadingId === item.youtube_id ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Ionicons name="play" size={18} color="#FFFFFF" />
                      )}
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Animated.View>

        {/* ── Quick Picks — 2-col bento grid, horizontal row cards ── */}
        <Animated.View entering={entering ? FadeInUp.delay(80).duration(350) : undefined} style={styles.section}>
          <SectionHeader title="Quick Picks" />
          {isQuickPicksLoading ? (
            <View style={styles.bentoGrid}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={i} style={styles.bentoCardSkeleton}>
                  <SkeletonBlock width={48} height={48} borderRadius={8} />
                  <View style={styles.skeletonTextGroup}>
                    <SkeletonBlock width="80%" height={13} borderRadius={4} />
                    <SkeletonBlock width="56%" height={11} borderRadius={4} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <FlashList
              data={quickPicks}
              keyExtractor={(item) => item.id}
              numColumns={2}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.bentoCard, pressed && styles.cardPressed]}
                  onPress={() => void handlePlayQuickPick(item)}
                >
                  <Image
                    source={item.thumbnail_url ? { uri: item.thumbnail_url } : undefined}
                    style={styles.bentoThumb}
                    contentFit="cover"
                  />
                  {loadingId === item.id ? (
                    <ActivityIndicator
                      color="#7C3AED"
                      size="small"
                      style={StyleSheet.absoluteFillObject}
                    />
                  ) : null}
                  <View style={styles.bentoTextGroup}>
                    <Text numberOfLines={1} style={styles.bentoTitle}>
                      {item.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.bentoSubtitle}>
                      {item.channel_name || 'Unknown'}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          )}
        </Animated.View>

        {/* ── Recently Played — horizontal scroll, 112px cards ── */}
        <Animated.View entering={entering ? FadeInUp.delay(160).duration(350) : undefined} style={styles.section}>
          <SectionHeader title="Recently Played" />
          {isHistoryLoading ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.historySkeletonRow}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={styles.historyCardSkeleton}>
                    <SkeletonBlock width={112} height={112} borderRadius={16} />
                    <SkeletonBlock width={90} height={13} borderRadius={4} />
                    <SkeletonBlock width={70} height={11} borderRadius={4} />
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <FlashList
              horizontal
              data={historyQuery.data ?? []}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyScroll}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.historyCard, pressed && styles.cardPressed]}
                  onPress={() => void handlePlayHistory(item)}
                >
                  <View style={styles.historyThumbWrapper}>
                    <Image
                      source={item.thumbnail_url ? { uri: item.thumbnail_url } : undefined}
                      style={styles.historyThumb}
                      contentFit="cover"
                    />
                    {loadingId === item.id ? (
                      <ActivityIndicator
                        color="#7C3AED"
                        size="small"
                        style={[StyleSheet.absoluteFillObject, styles.historyLoader]}
                      />
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={styles.historyTitle}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.historySubtitle}>
                    {item.channel_name || ''}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  content: {
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 12,
    // paddingBottom set dynamically via useBottomPadding
  },

  // ── Header ──
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  greeting: {
    color: '#7C3AED',
    fontSize: 24,
    fontWeight: '700',
    flex: 1,
    paddingRight: 12,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#2A1F4A',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Genre chips ──
  chipsScroll: {
    marginBottom: 24,
    marginHorizontal: -CONTENT_PADDING,
  },
  chipsRow: {
    paddingHorizontal: CONTENT_PADDING,
    gap: 8,
  },
  chip: {
    backgroundColor: '#333535',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: '#F5A623',
  },
  chipText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#1a1000',
  },

  // ── Sections ──
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },

  // ── Featured Today ──
  featuredSkeletonRow: {
    flexDirection: 'row',
    gap: FEATURED_GAP,
  },
  featuredScroll: {
    gap: FEATURED_GAP,
    paddingRight: CONTENT_PADDING,
  },
  featuredCard: {
    backgroundColor: '#121414',
    borderRadius: 16,
    height: FEATURED_CARD_HEIGHT,
    overflow: 'hidden',
    width: FEATURED_CARD_WIDTH,
  },
  featuredContent: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: 16,
  },
  featuredTextGroup: {
    flex: 1,
    paddingRight: 12,
  },
  featuredBadge: {
    color: '#7C3AED',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  featuredBadgeGold: {
    color: '#F5A623',
  },
  featuredTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  featuredArtist: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 3,
  },
  featuredPlayBtn: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
    flexShrink: 0,
  },

  // ── Quick Picks bento ──
  bentoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  bentoCardSkeleton: {
    alignItems: 'center',
    backgroundColor: '#121414',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    padding: 12,
    width: '48%',
  },
  skeletonTextGroup: {
    flex: 1,
    gap: 6,
  },
  bentoCard: {
    alignItems: 'center',
    backgroundColor: '#121414',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    padding: 12,
    width: '48%',
  },
  bentoThumb: {
    borderRadius: 8,
    height: 48,
    width: 48,
    flexShrink: 0,
  },
  bentoTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  bentoTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  bentoSubtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    marginTop: 2,
  },

  // ── Recently Played ──
  historyScroll: {
    gap: 16,
  },
  historySkeletonRow: {
    flexDirection: 'row',
    gap: 16,
  },
  historyCardSkeleton: {
    gap: 6,
    width: 112,
  },
  historyCard: {
    width: 112,
  },
  historyThumbWrapper: {
    borderRadius: 16,
    height: 112,
    marginBottom: 8,
    overflow: 'hidden',
    width: 112,
  },
  historyThumb: {
    height: 112,
    width: 112,
  },
  historyLoader: {
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  historyTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  historySubtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    marginTop: 2,
  },

  // ── Shared ──
  skeleton: {
    backgroundColor: '#1E1E1E',
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
});
