import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from '../services/toast';
import PlaylistCover from '../components/PlaylistCover';
import SkeletonLoader from '../components/SkeletonLoader';
import SongRow from '../components/SongRow';
import { CollapsingTopBar, PlayButtonSlot, StickyPlayButton, useCollapsingHeader } from '../components/CollapsingHeader';
import Chip from '../components/ui/Chip';
import EmptyState from '../components/ui/EmptyState';
import IconButton from '../components/ui/IconButton';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import { useLikedSongs, type LikedSong } from '../hooks/useLiked';
import { useHeroTint } from '../hooks/useArtworkColor';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { addSongsToPlaylist, createPlaylist, invalidatePlaylists } from '../services/libraryActions';
import { tapHaptic } from '../services/haptics';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Brand, Elevation, Layout, Radius, Space, Type } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type SortKey = 'recent' | 'title' | 'channel';
const SORT_LABELS: Record<SortKey, string> = { recent: 'Recently liked', title: 'Title', channel: 'Channel' };
const LIKED_CONTEXT = { type: 'liked' as const, name: 'Liked Songs', id: 'liked' };
const LIKED_PALETTE = { accent: Brand.kesar, background: '#4A2410', muted: '#24130A' };

function formatTotal(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

export default function LikedSongsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tint = useHeroTint(LIKED_PALETTE);
  const { scrollY, onScroll } = useCollapsingHeader();
  const likedQuery = useLikedSongs();
  const likedSongs = likedQuery.data ?? [];

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [sort, setSort] = useState<SortKey>('recent');
  const [anchorY, setAnchorY] = useState(0);
  const [isMaking, setIsMaking] = useState(false);

  const context = usePlayerStore((s) => s.context);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const isThisContext = context?.type === 'liked';

  // Filter tags: the channels you've liked the most songs from.
  const topChannels = useMemo(() => {
    const counts = new Map<string, number>();
    likedSongs.forEach((s) => s.channel_name && counts.set(s.channel_name, (counts.get(s.channel_name) ?? 0) + 1));
    return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
  }, [likedSongs]);

  const visibleSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: LikedSong[] = likedSongs.filter(
      (s) => (!channelFilter || s.channel_name === channelFilter) && (!q || s.title.toLowerCase().includes(q) || (s.channel_name ?? '').toLowerCase().includes(q))
    );
    if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'channel') list = [...list].sort((a, b) => (a.channel_name ?? '').localeCompare(b.channel_name ?? ''));
    return list;
  }, [likedSongs, channelFilter, query, sort]);
  const totalDuration = useMemo(() => visibleSongs.reduce((sum, s) => sum + (s.duration_sec ?? 0), 0), [visibleSongs]);

  const play = async (index: number, shuffle?: boolean) => {
    const song = visibleSongs[index];
    if (!song) return;
    if (!shuffle) setLoadingId(song.id);
    try {
      await playback.playSongs(visibleSongs, index, LIKED_CONTEXT, { shuffle });
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't start playback", text2: 'Check your connection and try again.' });
    } finally {
      setLoadingId(null);
    }
  };

  const toggleShuffle = () => {
    tapHaptic();
    if (isThisContext) void playback.cycleShuffle();
    else usePlayerStore.setState({ shuffleMode: shuffleMode === 'off' ? 'shuffle' : 'off' });
  };

  const cycleSort = () => {
    tapHaptic();
    const order: SortKey[] = ['recent', 'title', 'channel'];
    setSort(order[(order.indexOf(sort) + 1) % order.length]);
  };

  const makePlaylist = async () => {
    if (!visibleSongs.length || isMaking) return;
    setIsMaking(true);
    try {
      const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const name = channelFilter ? `${channelFilter} favourites` : `Liked Songs · ${date}`;
      const playlist = await createPlaylist(name, `Made from your Liked Songs on ${date}`);
      await addSongsToPlaylist(visibleSongs.map((s) => s.id), playlist.id);
      invalidatePlaylists([playlist.id]);
      Toast.show({ type: 'success', text1: `Created "${name}"`, text2: `${visibleSongs.length} songs` });
      navigation.navigate('Playlist', { playlistId: playlist.id });
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't create the playlist" });
    } finally {
      setIsMaking(false);
    }
  };

  const header = (
    <View>
      <LinearGradient colors={[tint.top, colors.bg]} style={[styles.hero, { paddingTop: insets.top + 64 }]}>
        <Rise style={Elevation.art}>
          <PlaylistCover variant="liked" size={148} borderRadius={Radius.lg} />
        </Rise>
        <Rise index={1} style={{ gap: Space[2] }}>
          <Text variant="hero">Liked Songs</Text>
          <Text variant="mono" color="textSecondary" tabular>
            {visibleSongs.length} songs{totalDuration > 0 ? `  ·  ${formatTotal(totalDuration)}` : ''}
          </Text>
        </Rise>
      </LinearGradient>

      {likedSongs.length > 0 ? (
        <>
          {isSearching ? (
            <View style={styles.searchRow}>
              <Ionicons name="search" size={18} color={colors.textTertiary} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Find in Liked Songs" placeholderTextColor={colors.textTertiary}
                style={styles.searchInput} autoFocus accessibilityLabel="Find in Liked Songs" />
              <Pressable onPress={() => { setQuery(''); setIsSearching(false); }} hitSlop={10} accessibilityLabel="Close search">
                <Ionicons name="close" size={18} color={colors.textTertiary} />
              </Pressable>
            </View>
          ) : null}
          {topChannels.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {topChannels.map((c) => (
                <Chip key={c} label={c} selected={channelFilter === c} icon={channelFilter === c ? 'close' : undefined} onPress={() => setChannelFilter(channelFilter === c ? null : c)} />
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.actions} onLayout={(e) => setAnchorY(e.nativeEvent.layout.y)}>
            <IconButton icon="search" onPress={() => setIsSearching(true)} accessibilityLabel="Find in Liked Songs" color={colors.textSecondary} />
            <Pressable onPress={cycleSort} hitSlop={6} style={styles.sort} accessibilityRole="button" accessibilityLabel={`Sort: ${SORT_LABELS[sort]}`}>
              <Ionicons name="swap-vertical" size={16} color={colors.textSecondary} />
              <Text variant="captionStrong" color="textSecondary">{SORT_LABELS[sort]}</Text>
            </Pressable>
            {isMaking ? (
              <ActivityIndicator color={colors.textSecondary} style={{ width: Layout.touchTarget }} />
            ) : (
              <IconButton icon="duplicate-outline" onPress={() => void makePlaylist()} accessibilityLabel="Make these into a playlist" color={colors.textSecondary} />
            )}
            <View style={{ flex: 1 }} />
            <IconButton icon="shuffle" onPress={toggleShuffle} accessibilityLabel={shuffleMode === 'off' ? 'Shuffle off' : 'Shuffle on'}
              color={shuffleMode === 'off' ? colors.textSecondary : colors.accentInk} iconSize={26} />
            <PlayButtonSlot />
          </View>
        </>
      ) : null}
    </View>
  );

  const empty = likedQuery.isLoading ? (
    <View style={{ gap: Space[3], paddingHorizontal: Layout.gutter }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3] }}>
          <SkeletonLoader width={48} height={48} />
          <View style={{ flex: 1, gap: Space[2] }}>
            <SkeletonLoader width="65%" height={13} />
            <SkeletonLoader width="40%" height={11} />
          </View>
        </View>
      ))}
    </View>
  ) : likedSongs.length === 0 ? (
    <EmptyState icon="heart-outline" title="Songs you love will live here" body="Tap the heart on any song and it'll be waiting for you." actionLabel="Find songs" onAction={() => navigation.navigate('Tabs', { screen: 'Search' })} />
  ) : (
    <EmptyState icon="filter-outline" title="Nothing matches" body="Clear the filter or try another word." compact />
  );

  return (
    <View style={styles.root}>
      <FlashList
        data={visibleSongs}
        keyExtractor={(item) => item.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: insets.bottom + Space[16] }}
        renderItem={({ item, index }) => <SongRow song={item} isLoading={loadingId === item.id} onPress={() => void play(index)} />}
      />
      <CollapsingTopBar scrollY={scrollY} title="Liked Songs" background={tint.bar} ink={tint.ink} threshold={insets.top + 250} onBack={() => navigation.goBack()} />
      {likedSongs.length > 0 ? (
        <StickyPlayButton scrollY={scrollY} anchorY={anchorY} isPlaying={isThisContext && isPlaying}
          onPress={() => (isThisContext ? void playback.togglePlay() : void play(0, shuffleMode !== 'off'))} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  hero: { gap: Space[5], paddingBottom: Space[5], paddingHorizontal: Layout.gutter },
  searchRow: {
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Space[2],
    height: 46,
    marginBottom: Space[3],
    marginHorizontal: Layout.gutter,
    paddingHorizontal: Space[4],
  },
  searchInput: { ...Type.body, color: t.colors.text, flex: 1, height: '100%' },
  chips: { gap: Space[2], paddingBottom: Space[2], paddingHorizontal: Layout.gutter },
  actions: { alignItems: 'center', flexDirection: 'row', gap: Space[1], height: 56, marginBottom: Space[2], paddingLeft: Space[3], paddingRight: Layout.gutter },
  sort: { alignItems: 'center', flexDirection: 'row', gap: Space[1], minHeight: Layout.touchTarget, paddingHorizontal: Space[1] },
}));
