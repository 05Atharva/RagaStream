import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Toast from '../services/toast';
import PlaylistCover from '../components/PlaylistCover';
import SkeletonLoader from '../components/SkeletonLoader';
import SongRow from '../components/SongRow';
import Chip from '../components/ui/Chip';
import SectionHeader from '../components/ui/SectionHeader';
import Tappable from '../components/ui/Tappable';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import { useFirstMount } from '../motion/primitives';
import { apiClient } from '../services/apiClient';
import * as playback from '../services/playbackController';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import type { Song } from '../hooks/useSongs';
import { useLikedSongs } from '../hooks/useLiked';
import { useListeningStats, useOnRepeat, useRecentlyPlayed } from '../hooks/useHistory';
import { useBottomPadding } from '../hooks/useBottomPadding';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, type RecentContext } from '../store/settingsStore';
import { openSongMenu } from '../store/songMenuStore';
import { Brand, Elevation, Layout, Radius, Space, alpha } from '../constants/theme';
import { makeStyles, useColors, useTheme } from '../theme/ThemeProvider';
import { currentPrahar } from '../theme/prahar';

type Props = BottomTabScreenProps<BottomTabParamList, 'Home'>;

const GENRES = ['Bollywood', 'Classical', 'Devotional', 'Ghazals', 'Sufi', 'Folk', 'Punjabi', 'Indie'] as const;

// PRD §7.1: 4 hand-picked tracks. Metadata is static so the row renders
// instantly; the stream is resolved only when a card is tapped.
const FEATURED: Array<playback.SongInput & { badge: string }> = [
  { youtube_id: 'BddP6PYo2gs', title: 'Kesariya', channel_name: 'Arijit Singh · Brahmāstra', badge: 'Editor’s pick' },
  { youtube_id: 'T94PHkuydcw', title: 'Kun Faya Kun', channel_name: 'A.R. Rahman · Rockstar', badge: 'Timeless' },
  { youtube_id: '5Eqb_-j3FDA', title: 'Pasoori', channel_name: 'Ali Sethi x Shae Gill', badge: 'Coke Studio' },
  { youtube_id: '81qmmlsIE3k', title: 'Tum Hi Ho', channel_name: 'Arijit Singh · Aashiqui 2', badge: 'Top 50' },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const FEATURED_WIDTH = SCREEN_WIDTH - Layout.gutter * 2 - 28;
const SHORTCUT_WIDTH = (SCREEN_WIDTH - Layout.gutter * 2 - Space[2]) / 2;
const CARD = 148;

function SongCard({ song, subtitle, onPress, loading }: { song: playback.SongInput; subtitle?: string; onPress: () => void; loading: boolean }) {
  const styles = useStyles();
  return (
    <Tappable style={{ width: CARD }} onPress={onPress} onLongPress={() => openSongMenu(song)} pressScale={0.96}
      accessibilityRole="button" accessibilityLabel={`${song.title}, ${song.channel_name ?? ''}`}>
      <View style={styles.cardArt}>
        <Image source={{ uri: song.thumbnail_url || playback.thumbnailFor(song.youtube_id) }} style={styles.fill} contentFit="cover" transition={150} />
        {loading ? <View style={styles.cardLoader}><ActivityIndicator color="#FFFFFF" /></View> : null}
      </View>
      <Text variant="captionStrong" numberOfLines={1}>{song.title}</Text>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>{subtitle ?? song.channel_name}</Text>
    </Tappable>
  );
}

/** Chips filter Home in place (US-08): the genre's popular songs appear right here. */
function GenreSection({ genre, onOpenNowPlaying }: { genre: string; onOpenNowPlaying: () => void }) {
  const colors = useColors();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['genre-home', genre],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: results } = await apiClient.get<playback.YouTubeResult[]>('/youtube/search', { params: { q: `${genre} songs`, limit: 20 } });
      return results.map(playback.fromYouTube);
    },
  });
  const songs = data ?? [];

  const play = async (index: number, shuffle?: boolean) => {
    setLoadingId(shuffle ? null : songs[index]?.youtube_id ?? null);
    try {
      await playback.playSongs(songs, index, { type: 'home', name: genre, id: `genre-${genre}` }, { shuffle });
      onOpenNowPlaying();
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't play this song", text2: 'Try another one.' });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <View>
      <Rise style={{ alignItems: 'flex-end', flexDirection: 'row', gap: Space[3], marginBottom: Space[3], paddingHorizontal: Layout.gutter }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="display">{genre}</Text>
          <Text variant="caption" color="textSecondary">Popular right now</Text>
        </View>
        <Pressable onPress={() => void play(0, true)} disabled={!songs.length} accessibilityLabel={`Shuffle ${genre}`}
          style={{ alignItems: 'center', height: Layout.touchTarget, justifyContent: 'center', width: Layout.touchTarget }}>
          <Ionicons name="shuffle" size={24} color={colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => void play(0)} disabled={!songs.length} accessibilityLabel={`Play ${genre}`}
          style={[{ alignItems: 'center', backgroundColor: colors.accent, borderRadius: Radius.pill, height: 52, justifyContent: 'center', width: 52 }, Elevation.floating]}>
          <Ionicons name="play" size={22} color={colors.onAccent} style={{ marginLeft: 3 }} />
        </Pressable>
      </Rise>
      {isLoading
        ? Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: Space[3], paddingHorizontal: Layout.gutter, paddingVertical: Space[2] }}>
              <SkeletonLoader width={48} height={48} />
              <View style={{ flex: 1, gap: Space[2], justifyContent: 'center' }}>
                <SkeletonLoader width="70%" height={13} />
                <SkeletonLoader width="40%" height={11} />
              </View>
            </View>
          ))
        : songs.map((song, index) => (
            <Rise key={song.youtube_id} index={index}>
              <SongRow song={song} index={index + 1} isLoading={loadingId === song.youtube_id} onPress={() => void play(index)} />
            </Rise>
          ))}
    </View>
  );
}

export default function HomeScreen({ navigation }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const { isDark } = useTheme();
  const root = navigation.getParent();
  const openNowPlaying = () => root?.navigate('NowPlaying');
  const firstMount = useFirstMount();
  const prahar = useMemo(() => currentPrahar(), []);
  const session = useAuthStore((s) => s.session);
  const displayName =
    (session?.user?.user_metadata?.name as string | undefined)?.split(' ')[0] ||
    (session?.user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] ||
    session?.user?.email?.split('@')[0] ||
    'there';

  const [genre, setGenre] = useState<string | null>(null);
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
    queryFn: async () => (await apiClient.get<Song[]>('/songs', { params: { limit: 6 } })).data,
    retry: false,
  });

  const quickPicks = (likedQuery.data?.length ?? 0) > 0 ? likedQuery.data!.slice(0, 6) : fallbackQuery.data ?? [];
  const history = (historyQuery.data ?? []).slice(0, 12);
  const onRepeat = onRepeatQuery.data ?? [];
  const mixes = statsQuery.data?.top_channels.filter((c) => c.plays >= 2) ?? [];
  const shortcuts = recentContexts.filter((c) => c.type !== 'liked').slice(0, 5);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (loadingId) return;
    setLoadingId(key);
    try {
      await fn();
      openNowPlaying();
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't start playback", text2: 'Check your connection and try again.' });
    } finally {
      setLoadingId(null);
    }
  };

  const playList = (songs: playback.SongInput[], index: number, name: string) =>
    run(songs[index]?.youtube_id ?? name, () => playback.playSongs(songs, index, { type: 'home', name }));

  const openContext = (context: RecentContext) => {
    if (context.type === 'playlist') root?.navigate('Playlist', { playlistId: context.id });
    else if (context.type === 'liked') root?.navigate('LikedSongs');
    else if (context.type === 'channel') root?.navigate('Channel', { channelName: context.id });
    else
      void run(context.id, () =>
        playback.startRadio(
          { youtube_id: context.id, title: context.name.replace(/ (Radio|Mix)$/, ''), thumbnail_url: context.thumbnail },
          context.name
        )
      );
  };

  const bottomPadding = useBottomPadding();
  let section = 0; // stagger index for entrance choreography

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* Prahar wash: the ambient colour of this hour of the day */}
      <LinearGradient
        pointerEvents="none"
        colors={[alpha(prahar.color, isDark ? 0.2 : 0.28), alpha(prahar.color, 0)]}
        style={styles.wash}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
        <Rise play={firstMount} index={section++} style={styles.header}>
          <View style={{ flex: 1, gap: Space[1] }}>
            <Text variant="label" color="textSecondary">{prahar.label} · Raag {prahar.raga}</Text>
            <Text variant="display" numberOfLines={2}>{prahar.greeting}, {displayName}</Text>
          </View>
          <Pressable onPress={() => root?.navigate('Settings')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Settings and profile" style={styles.avatar}>
            <Text variant="subtitle" color="onAccent">{displayName.charAt(0).toUpperCase()}</Text>
          </Pressable>
        </Rise>

        <Rise play={firstMount} index={section++}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="For you" selected={genre === null} onPress={() => setGenre(null)} />
            {GENRES.map((g) => (
              <Chip key={g} label={g} selected={genre === g} onPress={() => setGenre(genre === g ? null : g)} />
            ))}
          </ScrollView>
        </Rise>

        {genre ? (
          <GenreSection key={genre} genre={genre} onOpenNowPlaying={openNowPlaying} />
        ) : (
          <>
            {/* Jump back in (US-03) */}
            <Rise play={firstMount} index={section++} style={styles.shortcuts}>
              <Tappable style={styles.shortcut} onPress={() => root?.navigate('LikedSongs')} pressScale={0.97} accessibilityRole="button" accessibilityLabel="Liked Songs">
                <PlaylistCover variant="liked" size={56} borderRadius={0} />
                <Text variant="captionStrong" numberOfLines={2} style={styles.shortcutText}>Liked Songs</Text>
              </Tappable>
              {shortcuts.map((c) => (
                <Tappable key={`${c.type}-${c.id}`} style={styles.shortcut} onPress={() => openContext(c)} pressScale={0.97} accessibilityRole="button" accessibilityLabel={c.name}>
                  {c.thumbnail ? <Image source={{ uri: c.thumbnail }} style={{ width: 56, height: 56 }} contentFit="cover" /> : <PlaylistCover size={56} borderRadius={0} />}
                  <Text variant="captionStrong" numberOfLines={2} style={styles.shortcutText}>{c.name}</Text>
                  {loadingId === c.id ? <ActivityIndicator color={colors.accentInk} size="small" style={{ marginRight: Space[2] }} /> : null}
                </Tappable>
              ))}
            </Rise>

            <Rise play={firstMount} index={section++} style={styles.section}>
              <SectionHeader title="Featured today" subtitle="Hand-picked for this week" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={FEATURED_WIDTH + Space[3]} decelerationRate="fast" contentContainerStyle={styles.hScroll}>
                {FEATURED.map((item, index) => (
                  <Tappable key={item.youtube_id} style={styles.featured} pressScale={0.98} onPress={() => void playList(FEATURED, index, 'Featured today')}
                    onLongPress={() => openSongMenu(item)} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.channel_name}`}>
                    <Image source={{ uri: playback.thumbnailFor(item.youtube_id) }} style={styles.fill} contentFit="cover" />
                    <LinearGradient colors={['rgba(11,15,26,0)', 'rgba(11,15,26,0.55)', 'rgba(11,15,26,0.95)']} locations={[0.2, 0.55, 1]} style={styles.featuredShade} />
                    <View style={styles.featuredBody}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="label" color={Brand.kesarLight}>{item.badge}</Text>
                        <Text variant="headline" color="#FFFFFF" numberOfLines={1}>{item.title}</Text>
                        <Text variant="caption" color="rgba(255,255,255,0.75)" numberOfLines={1}>{item.channel_name}</Text>
                      </View>
                      <View style={styles.featuredPlay}>
                        {loadingId === item.youtube_id ? <ActivityIndicator color={colors.onAccent} /> : <Ionicons name="play" size={20} color={colors.onAccent} style={{ marginLeft: 2 }} />}
                      </View>
                    </View>
                  </Tappable>
                ))}
              </ScrollView>
            </Rise>

            {onRepeat.length >= 3 ? (
              <Rise play={firstMount} index={section++} style={styles.section}>
                <SectionHeader title="On repeat" subtitle="Songs you keep coming back to" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {onRepeat.map((song, i) => (
                    <SongCard key={song.id} song={song} subtitle={`${song.plays} plays`} loading={loadingId === song.youtube_id} onPress={() => void playList(onRepeat, i, 'On repeat')} />
                  ))}
                </ScrollView>
              </Rise>
            ) : null}

            {mixes.length > 0 ? (
              <Rise play={firstMount} index={section++} style={styles.section}>
                <SectionHeader title="Your mixes" subtitle="Endless radio from the channels you love" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {mixes.map((mix) => (
                    <Tappable key={mix.channel_name} style={{ width: CARD }} pressScale={0.96}
                      onPress={() => void run(mix.top_song.youtube_id, () => playback.startRadio(mix.top_song, `${mix.channel_name} Mix`))}
                      accessibilityRole="button" accessibilityLabel={`${mix.channel_name} Mix`}>
                      <View style={styles.cardArt}>
                        <Image source={{ uri: mix.thumbnail_url ?? playback.thumbnailFor(mix.top_song.youtube_id) }} style={styles.fill} contentFit="cover" />
                        <LinearGradient colors={['rgba(11,15,26,0)', alpha(Brand.kesar, 0.92)]} locations={[0.35, 1]} style={styles.mixShade}>
                          <Text variant="title" color={colors.onAccent} numberOfLines={2}>{mix.channel_name}</Text>
                          <Text variant="label" color={colors.onAccent}>Mix</Text>
                        </LinearGradient>
                        {loadingId === mix.top_song.youtube_id ? <View style={styles.cardLoader}><ActivityIndicator color="#FFFFFF" /></View> : null}
                      </View>
                      <Text variant="caption" color="textSecondary" numberOfLines={2}>Starts with {mix.top_song.title}</Text>
                    </Tappable>
                  ))}
                </ScrollView>
              </Rise>
            ) : null}

            <Rise play={firstMount} index={section++} style={styles.section}>
              <SectionHeader title="Quick picks" subtitle={(likedQuery.data?.length ?? 0) > 0 ? 'From your Liked Songs' : 'From the catalogue'} />
              <View style={styles.quickGrid}>
                {likedQuery.isLoading
                  ? Array.from({ length: 6 }).map((_, i) => <SkeletonLoader key={i} width={SHORTCUT_WIDTH} height={56} borderRadius={Radius.sm} />)
                  : quickPicks.map((song, i) => (
                      <Tappable key={song.id} style={styles.quick} pressScale={0.97} onPress={() => void playList(quickPicks, i, 'Quick picks')}
                        onLongPress={() => openSongMenu(song)} accessibilityRole="button" accessibilityLabel={`${song.title}, ${song.channel_name ?? ''}`}>
                        <Image source={{ uri: song.thumbnail_url ?? undefined }} style={{ width: 56, height: 56 }} contentFit="cover" />
                        <View style={{ flex: 1, minWidth: 0, paddingRight: Space[2] }}>
                          <Text variant="captionStrong" numberOfLines={1}>{song.title}</Text>
                          <Text variant="caption" color="textSecondary" numberOfLines={1}>{song.channel_name}</Text>
                        </View>
                        {loadingId === song.youtube_id ? <ActivityIndicator color={colors.accentInk} size="small" style={{ marginRight: Space[2] }} /> : null}
                      </Tappable>
                    ))}
              </View>
            </Rise>

            <Rise play={firstMount} index={section++} style={styles.section}>
              <SectionHeader title="Recently played" />
              {historyQuery.isLoading ? (
                <View style={[styles.hScroll, { flexDirection: 'row' }]}>
                  {[0, 1, 2].map((i) => <SkeletonLoader key={i} width={CARD} height={CARD} borderRadius={Radius.md} />)}
                </View>
              ) : history.length === 0 ? (
                <Text variant="caption" color="textSecondary" style={{ paddingHorizontal: Layout.gutter }}>
                  Songs you play will collect here, so you can find them again in one tap.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {history.map((song, i) => (
                    <SongCard key={song.id} song={song} loading={loadingId === song.youtube_id} onPress={() => void playList(history, i, 'Recently played')} />
                  ))}
                </ScrollView>
              )}
            </Rise>

            <Rise play={firstMount} index={section++} style={{ paddingHorizontal: Layout.gutter }}>
              <Tappable style={styles.stats} pressScale={0.98} onPress={() => root?.navigate('Stats')} accessibilityRole="button" accessibilityLabel="Your listening stats">
                <LinearGradient colors={[Brand.kesar, '#D9466B', Brand.neelDeep]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fillAbs} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" color="rgba(255,255,255,0.85)">Your listening</Text>
                  <Text variant="headline" color="#FFFFFF">Top songs and channels</Text>
                  <Text variant="caption" color="rgba(255,255,255,0.85)">This month, this year and all time</Text>
                </View>
                <Ionicons name="arrow-forward" size={22} color="#FFFFFF" />
              </Tappable>
            </Rise>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  wash: { height: 320, left: 0, position: 'absolute', right: 0, top: 0 },
  fill: { height: '100%', width: '100%' },
  fillAbs: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  header: { alignItems: 'center', flexDirection: 'row', gap: Space[4], paddingBottom: Space[4], paddingHorizontal: Layout.gutter, paddingTop: Space[3] },
  avatar: { alignItems: 'center', backgroundColor: t.colors.accent, borderRadius: Radius.pill, height: Layout.touchTarget, justifyContent: 'center', width: Layout.touchTarget },
  chips: { gap: Space[2], paddingBottom: Space[5], paddingHorizontal: Layout.gutter },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2], marginBottom: Space[8], paddingHorizontal: Layout.gutter },
  shortcut: {
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: Radius.sm,
    flexDirection: 'row',
    gap: Space[3],
    height: 56,
    overflow: 'hidden',
    width: SHORTCUT_WIDTH,
    ...(t.isDark ? {} : Elevation.card),
  },
  shortcutText: { flex: 1, paddingRight: Space[2] },
  section: { marginBottom: Space[8] },
  hScroll: { gap: Space[3], paddingHorizontal: Layout.gutter },
  featured: { backgroundColor: t.colors.surface, borderRadius: Radius.lg, height: 208, overflow: 'hidden', width: FEATURED_WIDTH },
  featuredShade: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  featuredBody: { alignItems: 'flex-end', bottom: 0, flexDirection: 'row', gap: Space[3], left: 0, padding: Space[5], position: 'absolute', right: 0 },
  featuredPlay: { alignItems: 'center', backgroundColor: t.colors.accent, borderRadius: Radius.pill, height: 48, justifyContent: 'center', width: 48 },
  cardArt: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.md, height: CARD, marginBottom: Space[2], overflow: 'hidden', width: CARD },
  cardLoader: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  mixShade: { bottom: 0, justifyContent: 'flex-end', left: 0, padding: Space[3], position: 'absolute', right: 0, top: 0 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2], paddingHorizontal: Layout.gutter },
  quick: {
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: Radius.sm,
    flexDirection: 'row',
    gap: Space[3],
    height: 56,
    overflow: 'hidden',
    width: SHORTCUT_WIDTH,
    ...(t.isDark ? {} : Elevation.card),
  },
  stats: { alignItems: 'center', borderRadius: Radius.lg, flexDirection: 'row', gap: Space[4], overflow: 'hidden', padding: Space[5] },
}));
