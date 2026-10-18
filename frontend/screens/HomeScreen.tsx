import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Toast from 'react-native-toast-message';
import PressableCard from '../components/PressableCard';
import PlaylistCover from '../components/PlaylistCover';
import SkeletonLoader from '../components/SkeletonLoader';
import SongRow from '../components/SongRow';
import { apiClient } from '../services/apiClient';
import * as playback from '../services/playbackController';
import { tapHaptic } from '../services/haptics';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import type { Song } from '../hooks/useSongs';
import { useLikedSongs } from '../hooks/useLiked';
import { useListeningStats, useOnRepeat, useRecentlyPlayed } from '../hooks/useHistory';
import { useBottomPadding } from '../hooks/useBottomPadding';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, type RecentContext } from '../store/settingsStore';
import { openSongMenu } from '../store/songMenuStore';
import { Colors, Motion, TypeScale } from '../constants/theme';

type Props = BottomTabScreenProps<BottomTabParamList, 'Home'>;

const GENRES = ['Bollywood', 'Classical', 'Folk', 'Devotional', 'Indie', 'Punjabi', 'Ghazals', 'Sufi'] as const;

// PRD §7.1: 4 hardcoded tracks as banner cards. Metadata is static so the row
// renders instantly; the stream is only resolved when a card is tapped.
const FEATURED: Array<playback.SongInput & { badge: string }> = [
  { youtube_id: '81qmmlsIE3k', title: 'Tum Hi Ho', channel_name: 'Arijit Singh · Aashiqui 2', badge: 'TOP 50' },
  { youtube_id: 'T94PHkuydcw', title: 'Kun Faya Kun', channel_name: 'A.R. Rahman · Rockstar', badge: 'FEATURED' },
  { youtube_id: '5Eqb_-j3FDA', title: 'Pasoori', channel_name: 'Ali Sethi x Shae Gill · Coke Studio', badge: 'TRENDING' },
  { youtube_id: 'BddP6PYo2gs', title: 'Kesariya', channel_name: 'Arijit Singh · Brahmāstra', badge: 'NEW RELEASE' },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTENT_PADDING = 16;
const FEATURED_CARD_WIDTH = (SCREEN_WIDTH - CONTENT_PADDING * 2) * 0.85;
const FEATURED_CARD_HEIGHT = 190;
const SHORTCUT_WIDTH = (SCREEN_WIDTH - CONTENT_PADDING * 2 - 8) / 2;
const CARD_SIZE = 140;

function getGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && { transform: [{ scale: Motion.pressScale }] },
      ]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

/** Square card for horizontal rows (On Repeat, Recently played). */
function SongCard({
  song,
  subtitle,
  onPress,
  isLoading,
}: {
  song: playback.SongInput;
  subtitle?: string;
  onPress: () => void;
  isLoading: boolean;
}) {
  return (
    <PressableCard style={styles.card} onPress={onPress} onLongPress={() => openSongMenu(song)}>
      <View style={styles.cardThumbWrap}>
        <Image
          source={{ uri: song.thumbnail_url || playback.thumbnailFor(song.youtube_id) }}
          style={styles.cardThumb}
          contentFit="cover"
        />
        {isLoading ? (
          <View style={styles.cardLoader}>
            <ActivityIndicator color="#FFFFFF" size="small" />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.cardTitle}>{song.title}</Text>
      <Text numberOfLines={1} style={styles.cardSubtitle}>{subtitle ?? song.channel_name}</Text>
    </PressableCard>
  );
}

/** In-place genre view: chips filter Home instead of jumping to Search. */
function GenreSection({ genre, onOpenNowPlaying }: { genre: string; onOpenNowPlaying: () => void }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['genre-home', genre],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: results } = await apiClient.get<playback.YouTubeResult[]>('/youtube/search', {
        params: { q: `${genre} songs`, limit: 20 },
      });
      return results.map(playback.fromYouTube);
    },
  });
  const songs = data ?? [];
  const context = { type: 'home' as const, name: genre, id: `genre-${genre}` };

  const play = async (index: number, shuffle?: boolean) => {
    setLoadingId(shuffle ? null : songs[index]?.youtube_id ?? null);
    try {
      await playback.playSongs(songs, index, context, { shuffle });
      onOpenNowPlaying();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not play this track' });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(Motion.duration.enter)}>
      <View style={styles.genreHeader}>
        <View style={styles.flex}>
          <Text style={styles.genreTitle}>{genre}</Text>
          <Text style={styles.sectionSubtitle}>Popular right now</Text>
        </View>
        <Pressable onPress={() => void play(0, true)} disabled={!songs.length} style={styles.genreShuffle}>
          <Ionicons name="shuffle" size={18} color="#FFFFFF" />
        </Pressable>
        <Pressable onPress={() => void play(0)} disabled={!songs.length} style={styles.genrePlay}>
          <Ionicons name="play" size={22} color="#FFFFFF" style={{ marginLeft: 2 }} />
        </Pressable>
      </View>
      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 32 }} />
      ) : (
        songs.map((song, index) => (
          <SongRow
            key={song.youtube_id}
            song={song}
            index={index + 1}
            isLoading={loadingId === song.youtube_id}
            onPress={() => void play(index)}
          />
        ))
      )}
    </Animated.View>
  );
}

export default function HomeScreen({ navigation }: Props) {
  const rootNavigation = navigation.getParent();
  const openNowPlaying = () => rootNavigation?.navigate('NowPlaying');
  const session = useAuthStore((state) => state.session);
  const displayName =
    (session?.user?.user_metadata?.name as string | undefined) ||
    (session?.user?.user_metadata?.full_name as string | undefined) ||
    session?.user?.email?.split('@')[0] ||
    'Listener';

  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const recentContexts = useSettingsStore((s) => s.recentContexts);
  const historyQuery = useRecentlyPlayed();
  const onRepeatQuery = useOnRepeat();
  const statsQuery = useListeningStats('long', 6);
  const likedQuery = useLikedSongs();

  const shouldFallback = (likedQuery.isSuccess && likedQuery.data.length === 0) || likedQuery.isError;
  const fallbackQuery = useQuery({
    queryKey: ['songs', 'quick-picks-fallback'],
    enabled: shouldFallback,
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/songs', { params: { limit: 6 } });
      return data;
    },
    retry: false,
  });

  const quickPicks = useMemo(
    () => ((likedQuery.data?.length ?? 0) > 0 ? likedQuery.data!.slice(0, 6) : fallbackQuery.data ?? []),
    [likedQuery.data, fallbackQuery.data]
  );
  const history = (historyQuery.data ?? []).slice(0, 12);
  const onRepeat = onRepeatQuery.data ?? [];
  const mixes = statsQuery.data?.top_channels.filter((c) => c.plays >= 2) ?? [];

  const playList = async (songs: playback.SongInput[], index: number, name: string) => {
    if (loadingId) return;
    setLoadingId(songs[index]?.youtube_id ?? null);
    try {
      await playback.playSongs(songs, index, { type: 'home', name });
      openNowPlaying();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not play this track' });
    } finally {
      setLoadingId(null);
    }
  };

  const playMix = async (channel: string, seed: Song) => {
    if (loadingId) return;
    setLoadingId(seed.youtube_id);
    try {
      await playback.startRadio(seed, `${channel} Mix`);
      openNowPlaying();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not start this mix' });
    } finally {
      setLoadingId(null);
    }
  };

  const openContext = async (context: RecentContext) => {
    switch (context.type) {
      case 'playlist':
        rootNavigation?.navigate('Playlist', { playlistId: context.id });
        return;
      case 'liked':
        rootNavigation?.navigate('LikedSongs');
        return;
      case 'channel':
        rootNavigation?.navigate('Channel', { channelName: context.id });
        return;
      case 'radio':
        setLoadingId(context.id);
        try {
          await playback.startRadio(
            { youtube_id: context.id, title: context.name.replace(/ (Radio|Mix)$/, ''), thumbnail_url: context.thumbnail },
            context.name
          );
          openNowPlaying();
        } catch {
          Toast.show({ type: 'error', text1: 'Could not start radio' });
        } finally {
          setLoadingId(null);
        }
    }
  };

  const bottomPadding = useBottomPadding();
  const hasAnimated = useRef(false);
  useEffect(() => { hasAnimated.current = true; }, []);
  const entering = !hasAnimated.current;

  // Shortcut grid: Liked Songs + whatever you played from recently.
  const shortcuts = recentContexts.filter((c) => c.type !== 'liked').slice(0, 5);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <Animated.View entering={entering ? FadeInDown.duration(Motion.duration.enter) : undefined} style={styles.header}>
          <Pressable onPress={() => rootNavigation?.navigate('Settings')} style={styles.avatar} hitSlop={8} accessibilityLabel="Settings">
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            <Chip label="All" selected={selectedGenre === null} onPress={() => setSelectedGenre(null)} />
            {GENRES.map((genre) => (
              <Chip
                key={genre}
                label={genre}
                selected={selectedGenre === genre}
                onPress={() => setSelectedGenre(selectedGenre === genre ? null : genre)}
              />
            ))}
          </ScrollView>
        </Animated.View>

        {selectedGenre ? (
          <GenreSection genre={selectedGenre} onOpenNowPlaying={openNowPlaying} />
        ) : (
          <>
            <Text style={styles.greeting}>{getGreeting()}, {displayName}</Text>

            {/* ── Shortcut grid ("Jump back in") ── */}
            <View style={styles.shortcutGrid}>
              <PressableCard style={styles.shortcut} onPress={() => rootNavigation?.navigate('LikedSongs')}>
                <PlaylistCover variant="liked" size={56} borderRadius={0} />
                <Text numberOfLines={2} style={styles.shortcutText}>Liked Songs</Text>
              </PressableCard>
              {shortcuts.map((context) => (
                <PressableCard key={`${context.type}-${context.id}`} style={styles.shortcut} onPress={() => void openContext(context)}>
                  {context.thumbnail ? (
                    <Image source={{ uri: context.thumbnail }} style={styles.shortcutImage} contentFit="cover" />
                  ) : (
                    <PlaylistCover size={56} borderRadius={0} />
                  )}
                  <Text numberOfLines={2} style={styles.shortcutText}>{context.name}</Text>
                  {loadingId === context.id ? <ActivityIndicator color="#FFFFFF" size="small" style={styles.shortcutLoader} /> : null}
                </PressableCard>
              ))}
            </View>

            {/* ── Featured Today ── */}
            <View style={styles.section}>
              <SectionHeader title="Featured Today" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={FEATURED_CARD_WIDTH + 12}
                decelerationRate="fast"
                contentContainerStyle={styles.hScroll}
              >
                {FEATURED.map((item, index) => (
                  <PressableCard
                    key={item.youtube_id}
                    style={styles.featuredCard}
                    onPress={() => void playList(FEATURED, index, 'Featured Today')}
                    onLongPress={() => openSongMenu(item)}
                  >
                    <Image
                      source={{ uri: `https://i.ytimg.com/vi/${item.youtube_id}/hqdefault.jpg` }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                    />
                    <LinearGradient
                      colors={['transparent', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.92)']}
                      locations={[0, 0.45, 1]}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <View style={styles.featuredContent}>
                      <View style={styles.flex}>
                        <Text style={[styles.featuredBadge, index % 2 === 1 && styles.featuredBadgeGold]}>{item.badge}</Text>
                        <Text numberOfLines={1} style={styles.featuredTitle}>{item.title}</Text>
                        <Text numberOfLines={1} style={styles.featuredArtist}>{item.channel_name}</Text>
                      </View>
                      <View style={styles.featuredPlayBtn}>
                        {loadingId === item.youtube_id ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <Ionicons name="play" size={18} color="#FFFFFF" style={{ marginLeft: 2 }} />
                        )}
                      </View>
                    </View>
                  </PressableCard>
                ))}
              </ScrollView>
            </View>

            {/* ── On Repeat ── */}
            {onRepeat.length >= 3 ? (
              <View style={styles.section}>
                <SectionHeader title="On Repeat" subtitle="Songs you can't stop playing" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {onRepeat.map((song, index) => (
                    <SongCard
                      key={song.id}
                      song={song}
                      subtitle={`${song.plays} plays · ${song.channel_name ?? ''}`}
                      isLoading={loadingId === song.youtube_id}
                      onPress={() => void playList(onRepeat, index, 'On Repeat')}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* ── Your mixes ── */}
            {mixes.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Your mixes" subtitle="Endless radio from the channels you play most" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {mixes.map((mix) => (
                    <PressableCard key={mix.channel_name} style={styles.card} onPress={() => void playMix(mix.channel_name, mix.top_song)}>
                      <View style={styles.cardThumbWrap}>
                        <Image
                          source={{ uri: mix.thumbnail_url ?? playback.thumbnailFor(mix.top_song.youtube_id) }}
                          style={styles.cardThumb}
                          contentFit="cover"
                        />
                        <LinearGradient colors={['transparent', 'rgba(124,58,237,0.85)']} style={styles.mixOverlay}>
                          <Text numberOfLines={2} style={styles.mixLabel}>{mix.channel_name} Mix</Text>
                        </LinearGradient>
                        {loadingId === mix.top_song.youtube_id ? (
                          <View style={styles.cardLoader}>
                            <ActivityIndicator color="#FFFFFF" size="small" />
                          </View>
                        ) : null}
                      </View>
                      <Text numberOfLines={2} style={styles.cardSubtitle}>Based on {mix.top_song.title}</Text>
                    </PressableCard>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* ── Quick Picks ── */}
            <View style={styles.section}>
              <SectionHeader title="Quick Picks" />
              {likedQuery.isLoading ? (
                <View style={styles.quickGrid}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <SkeletonLoader key={i} width={SHORTCUT_WIDTH} height={56} borderRadius={8} />
                  ))}
                </View>
              ) : (
                <View style={styles.quickGrid}>
                  {quickPicks.map((song, index) => (
                    <PressableCard
                      key={song.id}
                      style={styles.quickCard}
                      onPress={() => void playList(quickPicks, index, 'Quick Picks')}
                      onLongPress={() => openSongMenu(song)}
                    >
                      <Image source={{ uri: song.thumbnail_url ?? undefined }} style={styles.quickThumb} contentFit="cover" />
                      <View style={styles.quickText}>
                        <Text numberOfLines={1} style={styles.quickTitle}>{song.title}</Text>
                        <Text numberOfLines={1} style={styles.quickSubtitle}>{song.channel_name || 'Unknown'}</Text>
                      </View>
                      {loadingId === song.youtube_id ? <ActivityIndicator color={Colors.primaryLight} size="small" /> : null}
                    </PressableCard>
                  ))}
                </View>
              )}
            </View>

            {/* ── Recently played ── */}
            <View style={styles.section}>
              <SectionHeader title="Recently played" />
              {historyQuery.isLoading ? (
                <View style={styles.hRow}>
                  {[0, 1, 2].map((i) => (
                    <SkeletonLoader key={i} width={CARD_SIZE} height={CARD_SIZE} borderRadius={8} />
                  ))}
                </View>
              ) : history.length === 0 ? (
                <Text style={styles.emptyText}>Songs you play will show up here.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {history.map((song, index) => (
                    <SongCard
                      key={song.id}
                      song={song}
                      isLoading={loadingId === song.youtube_id}
                      onPress={() => void playList(history, index, 'Recently played')}
                    />
                  ))}
                </ScrollView>
              )}
            </View>

            {/* ── Stats entry ── */}
            <PressableCard style={styles.statsCard} onPress={() => rootNavigation?.navigate('Stats')}>
              <LinearGradient colors={['#4C1D95', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
              <Ionicons name="stats-chart" size={28} color="#FFFFFF" />
              <View style={styles.flex}>
                <Text style={styles.statsTitle}>Your listening stats</Text>
                <Text style={styles.statsSubtitle}>Top songs and channels, this month and all time</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
            </PressableCard>
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
  content: {
    paddingTop: 8,
  },
  flex: {
    flex: 1,
  },

  // ── Header + chips ──
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    paddingLeft: CONTENT_PADDING,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '700',
  },
  chipsRow: {
    gap: 8,
    paddingRight: CONTENT_PADDING,
  },
  chip: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipSelected: {
    backgroundColor: Colors.primary,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  greeting: {
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
    marginBottom: 12,
    paddingHorizontal: CONTENT_PADDING,
  },

  // ── Shortcut grid ──
  shortcutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
    paddingHorizontal: CONTENT_PADDING,
  },
  shortcut: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    height: 56,
    overflow: 'hidden',
    width: SHORTCUT_WIDTH,
  },
  shortcutImage: {
    height: 56,
    width: 56,
  },
  shortcutText: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: TypeScale.small,
    fontWeight: '700',
    paddingRight: 8,
  },
  shortcutLoader: {
    position: 'absolute',
    right: 8,
  },

  // ── Sections ──
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    marginBottom: 12,
    paddingHorizontal: CONTENT_PADDING,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
  },
  hScroll: {
    gap: 12,
    paddingHorizontal: CONTENT_PADDING,
  },
  hRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: CONTENT_PADDING,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: TypeScale.small,
    paddingHorizontal: CONTENT_PADDING,
  },

  // ── Featured ──
  featuredCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    height: FEATURED_CARD_HEIGHT,
    overflow: 'hidden',
    width: FEATURED_CARD_WIDTH,
  },
  featuredContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  featuredBadge: {
    color: Colors.primaryLight,
    fontSize: TypeScale.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  featuredBadgeGold: {
    color: Colors.secondary,
  },
  featuredTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.large,
    fontWeight: '700',
  },
  featuredArtist: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
  },
  featuredPlayBtn: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },

  // ── Cards ──
  card: {
    width: CARD_SIZE,
  },
  cardThumbWrap: {
    borderRadius: 8,
    height: CARD_SIZE,
    marginBottom: 8,
    overflow: 'hidden',
    width: CARD_SIZE,
  },
  cardThumb: {
    height: CARD_SIZE,
    width: CARD_SIZE,
  },
  cardLoader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
  },
  mixOverlay: {
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    padding: 10,
    position: 'absolute',
    right: 0,
    top: '40%',
  },
  mixLabel: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
    fontWeight: '800',
  },

  // ── Quick picks ──
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: CONTENT_PADDING,
  },
  quickCard: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    height: 56,
    overflow: 'hidden',
    paddingRight: 8,
    width: SHORTCUT_WIDTH,
  },
  quickThumb: {
    height: 56,
    width: 56,
  },
  quickText: {
    flex: 1,
    minWidth: 0,
  },
  quickTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  quickSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.caption,
    marginTop: 2,
  },

  // ── Genre view ──
  genreHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: CONTENT_PADDING,
  },
  genreTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.display,
    fontWeight: '700',
  },
  genreShuffle: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  genrePlay: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },

  // ── Stats card ──
  statsCard: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
    marginHorizontal: CONTENT_PADDING,
    overflow: 'hidden',
    padding: 20,
  },
  statsTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.large,
    fontWeight: '700',
  },
  statsSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: TypeScale.small,
    marginTop: 2,
  },
});
