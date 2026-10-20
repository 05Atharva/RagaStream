import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
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
import { useListeningStats, useOnRepeat, useRecentlyPlayed, type TopChannel } from '../hooks/useHistory';
import { useBottomPadding } from '../hooks/useBottomPadding';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, type RecentContext } from '../store/settingsStore';
import { openSongMenu } from '../store/songMenuStore';
import { Brand, Elevation, Layout, Motion, Radius, Space, alpha } from '../constants/theme';
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
const COLUMN_WIDTH = SCREEN_WIDTH - Layout.gutter * 2 - 40;
const CARD = 132;
const DECK_ART = 104;
const STOP = 84; // width of one stop on the trail
const STOP_ART = 64;
const NODE = 10;
const MIX = 136;
const MIX_OFFSET = 8;

const artOf = (song: playback.SongInput | undefined) =>
  song ? song.thumbnail_url || playback.thumbnailFor(song.youtube_id) : undefined;

function timeAgo(ts: number) {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pick up — the deck of what you played last, fanned out. The one Kesar action.

/** The last songs you played as a small deck; the cards behind fan out on arrival. */
function ResumeDeck({ thumbs, play }: { thumbs: (string | undefined)[]; play: boolean }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const fan = useSharedValue(play && !reduced ? 0 : 1);

  useEffect(() => {
    if (!play || reduced) return;
    fan.value = withDelay(Motion.stagger * 2, withTiming(1, { duration: Motion.duration.glide, easing: Motion.easing.out }));
  }, [fan, play, reduced]);

  const back1 = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(fan.value, [0, 1], [0, 16]) }, { rotate: `${fan.value * 4}deg` }, { scale: 0.9 }],
  }));
  const back2 = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(fan.value, [0, 1], [0, 30]) }, { rotate: `${fan.value * 8}deg` }, { scale: 0.8 }],
  }));

  const card = { borderRadius: Radius.md, height: DECK_ART, left: 0, overflow: 'hidden' as const, position: 'absolute' as const, top: 0, width: DECK_ART, backgroundColor: colors.surfaceRaised };
  return (
    <View style={{ height: DECK_ART, width: DECK_ART + 30 }}>
      {thumbs[2] ? (
        <Animated.View style={[card, { opacity: 0.45 }, back2]}>
          <Image source={{ uri: thumbs[2] }} style={{ height: '100%', width: '100%' }} contentFit="cover" />
        </Animated.View>
      ) : null}
      {thumbs[1] ? (
        <Animated.View style={[card, { opacity: 0.7 }, back1]}>
          <Image source={{ uri: thumbs[1] }} style={{ height: '100%', width: '100%' }} contentFit="cover" />
        </Animated.View>
      ) : null}
      <View style={[card, Elevation.floating]}>
        <Image source={thumbs[0] ? { uri: thumbs[0] } : undefined} style={{ height: '100%', width: '100%' }} contentFit="cover" transition={150} />
      </View>
    </View>
  );
}

function PickUp({ songs, label, detail, loading, play, onPress }: {
  songs: playback.SongInput[];
  label: string;
  detail: string;
  loading: boolean;
  play: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const lead = songs[0];
  if (!lead) return null;
  return (
    <Tappable style={styles.pickUp} pressScale={0.98} onPress={onPress} onLongPress={() => openSongMenu(lead)}
      accessibilityRole="button" accessibilityLabel={`${label}: ${lead.title}. ${detail}`}>
      <ResumeDeck thumbs={songs.slice(0, 3).map(artOf)} play={play} />
      <View style={{ flex: 1, justifyContent: 'space-between', minWidth: 0 }}>
        <View style={{ gap: 2 }}>
          <Text variant="label" color="textSecondary">{label}</Text>
          <Text variant="title" numberOfLines={2}>{lead.title}</Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>{lead.channel_name}</Text>
        </View>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], marginTop: Space[3] }}>
          <View style={[styles.playCircle, Elevation.floating]}>
            {loading ? <ActivityIndicator color={colors.onAccent} /> : <Ionicons name="play" size={20} color={colors.onAccent} style={{ marginLeft: 3 }} />}
          </View>
          <Text variant="mono" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>{detail}</Text>
        </View>
      </View>
    </Tappable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Your trail — where you've been today, on one line (the Queue's timeline, turned sideways).

function Trail({ stops, play, loadingId, onOpen }: {
  stops: RecentContext[];
  play: boolean;
  loadingId: string | null;
  onOpen: (context: RecentContext) => void;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const draw = useSharedValue(play && !reduced ? 0 : 1);
  const lineWidth = Math.max(0, (stops.length - 1) * (STOP + Space[3]));

  useEffect(() => {
    if (!play || reduced) return;
    draw.value = withDelay(Motion.stagger * 3, withTiming(1, { duration: Motion.duration.slow, easing: Motion.easing.glide }));
  }, [draw, play, reduced]);

  // Draw: the line grows left to right through the stops.
  const lineStyle = useAnimatedStyle(() => ({ width: draw.value * lineWidth }));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: Layout.gutter }}>
      <View>
        <Animated.View
          pointerEvents="none"
          style={[{ backgroundColor: alpha(colors.textTertiary, 0.5), height: 1.5, left: STOP / 2, position: 'absolute', top: NODE / 2 - 0.75 }, lineStyle]}
        />
        <View style={{ flexDirection: 'row', gap: Space[3] }}>
          {stops.map((stop, i) => {
            const round = stop.type === 'channel';
            return (
              <Tappable key={`${stop.type}-${stop.id}`} style={{ alignItems: 'center', width: STOP }} pressScale={0.96} onPress={() => onOpen(stop)}
                accessibilityRole="button" accessibilityLabel={`${stop.name}, ${stop.type === 'liked' ? 'your Liked Songs' : timeAgo(stop.playedAt)}`}>
                <View
                  style={{
                    backgroundColor: i === 0 ? colors.signal : colors.bg,
                    borderColor: i === 0 ? colors.signal : colors.textTertiary,
                    borderRadius: Radius.pill,
                    borderWidth: 1.5,
                    height: NODE,
                    marginBottom: Space[3],
                    width: NODE,
                  }}
                />
                <View style={{ borderRadius: round ? Radius.pill : Radius.sm, height: STOP_ART, overflow: 'hidden', width: STOP_ART }}>
                  {stop.type === 'liked' ? (
                    <PlaylistCover variant="liked" size={STOP_ART} borderRadius={Radius.sm} />
                  ) : stop.thumbnail ? (
                    <Image source={{ uri: stop.thumbnail }} style={{ height: '100%', width: '100%' }} contentFit="cover" />
                  ) : (
                    <PlaylistCover size={STOP_ART} borderRadius={round ? Radius.pill : Radius.sm} />
                  )}
                  {loadingId === stop.id ? (
                    <View style={{ alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 }}>
                      <ActivityIndicator color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>
                <Text variant="captionStrong" align="center" numberOfLines={2} style={{ marginTop: Space[2] }}>{stop.name}</Text>
                <Text variant="mono" color={i === 0 ? 'signal' : 'textSecondary'} align="center" numberOfLines={1}>
                  {stop.type === 'liked' && i !== 0 ? 'Always here' : timeAgo(stop.playedAt)}
                </Text>
              </Tappable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shelves

function SongCard({ song, subtitle, onPress, loading }: { song: playback.SongInput; subtitle?: string; onPress: () => void; loading: boolean }) {
  const styles = useStyles();
  return (
    <Tappable style={{ width: CARD }} onPress={onPress} onLongPress={() => openSongMenu(song)} pressScale={0.96}
      accessibilityRole="button" accessibilityLabel={`${song.title}, ${song.channel_name ?? ''}`}>
      <View style={styles.cardArt}>
        <Image source={{ uri: artOf(song) }} style={styles.fill} contentFit="cover" transition={150} />
        {loading ? <View style={styles.cardLoader}><ActivityIndicator color="#FFFFFF" /></View> : null}
      </View>
      <Text variant="captionStrong" numberOfLines={1}>{song.title}</Text>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>{subtitle ?? song.channel_name}</Text>
    </Tappable>
  );
}

/** On repeat as a setlist: numbered, with the play count where a duration would be. */
function SetlistRow({ song, number, plays, loading, onPress }: { song: Song; number: number; plays: number; loading: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Tappable style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: 60, paddingHorizontal: Layout.gutter }}
      pressScale={0.98} onPress={onPress} onLongPress={() => openSongMenu(song)}
      accessibilityRole="button" accessibilityLabel={`${number}. ${song.title}, ${song.channel_name ?? ''}, ${plays} plays`}>
      <Text variant="mono" color="textTertiary" tabular style={{ width: 22 }}>{String(number).padStart(2, '0')}</Text>
      <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: Radius.xs, height: 44, overflow: 'hidden', width: 44 }}>
        <Image source={{ uri: artOf(song) }} style={{ height: '100%', width: '100%' }} contentFit="cover" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subtitle" numberOfLines={1}>{song.title}</Text>
        <Text variant="caption" color="textSecondary" numberOfLines={1}>{song.channel_name}</Text>
      </View>
      {loading ? <ActivityIndicator color={colors.accentInk} size="small" /> : <Text variant="mono" color="textSecondary" tabular>{plays}×</Text>}
    </Tappable>
  );
}

/** A mix is a deck: the top song in front, more cards waiting behind it. */
function MixDeck({ mix, loading, onPress }: { mix: TopChannel; loading: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const back = { borderColor: alpha(colors.textTertiary, 0.35), borderRadius: Radius.md, borderWidth: 1, height: MIX, position: 'absolute' as const, width: MIX, backgroundColor: colors.surfaceRaised };
  return (
    <Tappable style={{ width: MIX + MIX_OFFSET * 2 }} pressScale={0.96} onPress={onPress}
      accessibilityRole="button" accessibilityLabel={`${mix.channel_name} Mix, starts with ${mix.top_song.title}`}>
      <View style={{ height: MIX + MIX_OFFSET * 2, marginBottom: Space[2], width: MIX + MIX_OFFSET * 2 }}>
        <View style={[back, { left: MIX_OFFSET * 2, top: 0 }]} />
        <View style={[back, { left: MIX_OFFSET, top: MIX_OFFSET }]} />
        <View style={[styles.mixFront, { top: MIX_OFFSET * 2 }]}>
          <Image source={{ uri: mix.thumbnail_url ?? playback.thumbnailFor(mix.top_song.youtube_id) }} style={styles.fill} contentFit="cover" />
          {loading ? <View style={styles.cardLoader}><ActivityIndicator color="#FFFFFF" /></View> : null}
        </View>
      </View>
      <Text variant="captionStrong" numberOfLines={1}>{mix.channel_name} Mix</Text>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>Starts with {mix.top_song.title}</Text>
    </Tappable>
  );
}

function Credit({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <View style={{ flex: grow ? 1 : undefined, gap: 2, minWidth: 0 }}>
      <Text variant="label" color="textSecondary">{label}</Text>
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Chips filter Home in place (US-08): the genre's popular songs appear right here. */
function GenreSection({ genre, onOpenNowPlaying }: { genre: string; onOpenNowPlaying: () => void }) {
  const colors = useColors();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
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
      {isLoading ? (
        Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: Space[3], paddingHorizontal: Layout.gutter, paddingVertical: Space[2] }}>
            <SkeletonLoader width={48} height={48} />
            <View style={{ flex: 1, gap: Space[2], justifyContent: 'center' }}>
              <SkeletonLoader width="70%" height={13} />
              <SkeletonLoader width="40%" height={11} />
            </View>
          </View>
        ))
      ) : isError ? (
        <Pressable onPress={() => void refetch()} accessibilityRole="button" style={{ paddingHorizontal: Layout.gutter, paddingVertical: Space[4] }}>
          <Text variant="body" color="textSecondary">Couldn't load {genre} songs. Check your connection, then tap to try again.</Text>
        </Pressable>
      ) : (
        songs.map((song, index) => (
          <Rise key={song.youtube_id} index={index}>
            <SongRow song={song} index={index + 1} isLoading={loadingId === song.youtube_id} onPress={() => void play(index)} />
          </Rise>
        ))
      )}
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
    queryFn: async () => (await apiClient.get<Song[]>('/songs', { params: { limit: 9 } })).data,
    retry: false,
  });

  const likedCount = likedQuery.data?.length ?? 0;
  const quickPicks = likedCount > 0 ? likedQuery.data!.slice(0, 9) : fallbackQuery.data ?? [];
  const history = (historyQuery.data ?? []).slice(0, 13);
  const onRepeat = (onRepeatQuery.data ?? []).slice(0, 5);
  const mixes = statsQuery.data?.top_channels.filter((c) => c.plays >= 2) ?? [];
  const stats = statsQuery.data;

  // The trail: newest first, Liked Songs always on it.
  const trail = useMemo(() => {
    const stops = [...recentContexts].sort((a, b) => b.playedAt - a.playedAt).slice(0, 8);
    if (!stops.some((c) => c.type === 'liked')) stops.push({ type: 'liked', id: 'liked', name: 'Liked Songs', playedAt: 0 });
    return stops;
  }, [recentContexts]);

  // Pick up: your last plays; before you've played anything, today's picks.
  const resumeFromHistory = history.length > 0;
  const pickUpSongs: playback.SongInput[] = resumeFromHistory ? history : FEATURED;
  const pickUpName = resumeFromHistory ? 'Recently played' : 'Featured today';

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
            {/* Pick up where you left off (US-03): the screen's one primary action */}
            <Rise play={firstMount} index={section++} style={styles.block}>
              {historyQuery.isLoading ? (
                <SkeletonLoader width="100%" height={DECK_ART + Space[4] * 2} borderRadius={Radius.lg} />
              ) : (
                <PickUp
                  songs={pickUpSongs}
                  label={resumeFromHistory ? 'Pick up where you left off' : 'Start here'}
                  detail={resumeFromHistory ? `${history.length} recent ${history.length === 1 ? 'song' : 'songs'}` : `${FEATURED.length} hand-picked songs`}
                  loading={loadingId === pickUpSongs[0]?.youtube_id}
                  play={firstMount}
                  onPress={() => void playList(pickUpSongs, 0, pickUpName)}
                />
              )}
            </Rise>

            {/* Your trail: playlists, channels and radios you've been to */}
            <Rise play={firstMount} index={section++} style={styles.section}>
              <SectionHeader title="Your trail" subtitle={trail.length > 1 ? 'Where you’ve been listening, newest first' : 'Open a playlist, channel or radio and it joins your trail'} />
              <Trail stops={trail} play={firstMount} loadingId={loadingId} onOpen={openContext} />
            </Rise>

            <Rise play={firstMount} index={section++} style={styles.section}>
              <SectionHeader title="Featured today" subtitle="Hand-picked for this week" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={FEATURED_WIDTH + Space[3]} decelerationRate="fast" contentContainerStyle={styles.hScroll}>
                {FEATURED.map((item, index) => (
                  <Tappable key={item.youtube_id} style={styles.featured} pressScale={0.98} onPress={() => void playList(FEATURED, index, 'Featured today')}
                    onLongPress={() => openSongMenu(item)} accessibilityRole="button" accessibilityLabel={`${item.badge}: ${item.title}, ${item.channel_name}`}>
                    <Image source={{ uri: playback.thumbnailFor(item.youtube_id) }} style={styles.fill} contentFit="cover" />
                    <LinearGradient colors={['rgba(11,15,26,0)', 'rgba(11,15,26,0.55)', 'rgba(11,15,26,0.95)']} locations={[0.2, 0.55, 1]} style={styles.fillAbs} />
                    <Text variant="mono" color="rgba(255,255,255,0.85)" style={styles.featuredNumber}>{String(index + 1).padStart(2, '0')} / {String(FEATURED.length).padStart(2, '0')}</Text>
                    <View style={styles.featuredBody}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="label" color={Brand.kesarLight}>{item.badge}</Text>
                        <Text variant="headline" color="#FFFFFF" numberOfLines={1}>{item.title}</Text>
                        <Text variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>{item.channel_name}</Text>
                      </View>
                      <View style={styles.featuredPlay}>
                        {loadingId === item.youtube_id ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="play" size={18} color="#FFFFFF" style={{ marginLeft: 2 }} />}
                      </View>
                    </View>
                  </Tappable>
                ))}
              </ScrollView>
            </Rise>

            {onRepeat.length >= 3 ? (
              <Rise play={firstMount} index={section++} style={styles.section}>
                <SectionHeader title="On repeat" subtitle="Your most-played songs this month" />
                {onRepeat.map((song, i) => (
                  <SetlistRow key={song.id} song={song} number={i + 1} plays={song.plays} loading={loadingId === song.youtube_id}
                    onPress={() => void playList(onRepeat, i, 'On repeat')} />
                ))}
              </Rise>
            ) : null}

            {mixes.length > 0 ? (
              <Rise play={firstMount} index={section++} style={styles.section}>
                <SectionHeader title="Your mixes" subtitle="Endless radio from the channels you play most" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {mixes.map((mix) => (
                    <MixDeck key={mix.channel_name} mix={mix} loading={loadingId === mix.top_song.youtube_id}
                      onPress={() => void run(mix.top_song.youtube_id, () => playback.startRadio(mix.top_song, `${mix.channel_name} Mix`))} />
                  ))}
                </ScrollView>
              </Rise>
            ) : null}

            <Rise play={firstMount} index={section++} style={styles.section}>
              <SectionHeader title="Quick picks" subtitle={likedCount > 0 ? 'From your Liked Songs' : 'From the catalogue'} />
              {likedQuery.isLoading ? (
                <View style={[styles.hScroll, { gap: Space[3] }]}>
                  {[0, 1, 2].map((i) => <SkeletonLoader key={i} width={COLUMN_WIDTH} height={48} />)}
                </View>
              ) : quickPicks.length === 0 ? (
                <Text variant="caption" color="textSecondary" style={{ paddingHorizontal: Layout.gutter }}>
                  Like a song with the heart and it shows up here for one-tap play.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={COLUMN_WIDTH + Space[3]} decelerationRate="fast" contentContainerStyle={styles.hScroll}>
                  {chunk(quickPicks, 3).map((column, c) => (
                    <View key={c} style={{ width: COLUMN_WIDTH }}>
                      {column.map((song, r) => {
                        const index = c * 3 + r;
                        return (
                          <Tappable key={song.id} style={styles.quickRow} pressScale={0.98} onPress={() => void playList(quickPicks, index, 'Quick picks')}
                            onLongPress={() => openSongMenu(song)} accessibilityRole="button" accessibilityLabel={`${song.title}, ${song.channel_name ?? ''}`}>
                            <View style={styles.quickArt}>
                              <Image source={{ uri: artOf(song) }} style={styles.fill} contentFit="cover" />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text variant="subtitle" numberOfLines={1}>{song.title}</Text>
                              <Text variant="caption" color="textSecondary" numberOfLines={1}>{song.channel_name}</Text>
                            </View>
                            {loadingId === song.youtube_id ? <ActivityIndicator color={colors.accentInk} size="small" /> : null}
                          </Tappable>
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
              )}
            </Rise>

            {history.length > 1 ? (
              <Rise play={firstMount} index={section++} style={styles.section}>
                <SectionHeader title="Recently played" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {history.slice(1).map((song, i) => (
                    <SongCard key={song.id} song={song} loading={loadingId === song.youtube_id} onPress={() => void playList(history, i + 1, 'Recently played')} />
                  ))}
                </ScrollView>
              </Rise>
            ) : null}

            {/* Your listening, as liner credits */}
            <Rise play={firstMount} index={section++} style={{ paddingHorizontal: Layout.gutter }}>
              <Tappable style={styles.credits} pressScale={0.98} onPress={() => root?.navigate('Stats')} accessibilityRole="button" accessibilityLabel="Your listening stats">
                <View style={{ alignItems: 'center', flexDirection: 'row' }}>
                  <Text variant="label" color="textSecondary" style={{ flex: 1 }}>Your listening · all time</Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.textSecondary} />
                </View>
                {stats && stats.total_plays > 0 ? (
                  <View style={{ flexDirection: 'row', gap: Space[5] }}>
                    <Credit label="Plays">
                      <Text variant="headline" tabular>{stats.total_plays}</Text>
                    </Credit>
                    {stats.top_channels[0] ? (
                      <Credit label="Top channel" grow>
                        <Text variant="captionStrong" numberOfLines={2}>{stats.top_channels[0].channel_name}</Text>
                      </Credit>
                    ) : null}
                    {stats.top_songs[0] ? (
                      <Credit label="Top song" grow>
                        <Text variant="captionStrong" numberOfLines={2}>{stats.top_songs[0].title}</Text>
                      </Credit>
                    ) : null}
                  </View>
                ) : (
                  <Text variant="body" color="textSecondary">Play a few songs and your top channels and songs show up here.</Text>
                )}
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
  block: { marginBottom: Space[8], paddingHorizontal: Layout.gutter },
  section: { marginBottom: Space[8] },
  hScroll: { gap: Space[3], paddingHorizontal: Layout.gutter },
  pickUp: {
    backgroundColor: t.colors.surface,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    gap: Space[4],
    padding: Space[4],
    ...(t.isDark ? {} : Elevation.card),
  },
  playCircle: { alignItems: 'center', backgroundColor: t.colors.accent, borderRadius: Radius.pill, height: 48, justifyContent: 'center', width: 48 },
  featured: { backgroundColor: t.colors.surface, borderRadius: Radius.lg, height: 208, overflow: 'hidden', width: FEATURED_WIDTH },
  featuredNumber: { left: Space[5], position: 'absolute', top: Space[4] },
  featuredBody: { alignItems: 'flex-end', bottom: 0, flexDirection: 'row', gap: Space[3], left: 0, padding: Space[5], position: 'absolute', right: 0 },
  featuredPlay: { alignItems: 'center', borderColor: 'rgba(255,255,255,0.6)', borderRadius: Radius.pill, borderWidth: 1.5, height: Layout.touchTarget, justifyContent: 'center', width: Layout.touchTarget },
  cardArt: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.md, height: CARD, marginBottom: Space[2], overflow: 'hidden', width: CARD },
  cardLoader: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  mixFront: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.md, height: MIX, left: 0, overflow: 'hidden', position: 'absolute', width: MIX, ...Elevation.floating },
  quickRow: { alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: 60 },
  quickArt: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.xs, height: 48, overflow: 'hidden', width: 48 },
  credits: {
    backgroundColor: t.colors.surface,
    borderRadius: Radius.lg,
    gap: Space[4],
    padding: Space[5],
    ...(t.isDark ? {} : Elevation.card),
  },
}));
