import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import SongRow from '../components/SongRow';
import {
  CollapsingTopBar,
  PlayButtonSlot,
  StickyPlayButton,
  useCollapsingHeader,
} from '../components/CollapsingHeader';
import { useLikedSongs, type LikedSong } from '../hooks/useLiked';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { addSongsToPlaylist, createPlaylist, invalidatePlaylists } from '../services/libraryActions';
import { tapHaptic } from '../services/haptics';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors, TypeScale } from '../constants/theme';

type SortKey = 'recent' | 'title' | 'channel';
const SORT_LABELS: Record<SortKey, string> = { recent: 'Recently added', title: 'Title', channel: 'Channel' };
const LIKED_CONTEXT = { type: 'liked' as const, name: 'Liked Songs', id: 'liked' };
const HERO_TINT = '#3B1784';

function formatTotal(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

export default function LikedSongsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { scrollY, onScroll } = useCollapsingHeader();
  const likedQuery = useLikedSongs();
  const likedSongs = likedQuery.data ?? [];

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [sort, setSort] = useState<SortKey>('recent');
  const [anchorY, setAnchorY] = useState(0);
  const [isMakingPlaylist, setIsMakingPlaylist] = useState(false);

  const context = usePlayerStore((s) => s.context);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const isThisPlaying = context?.type === 'liked' && isPlaying;

  // "Filter tags": the channels you've liked the most songs from.
  const topChannels = useMemo(() => {
    const counts = new Map<string, number>();
    likedSongs.forEach((s) => s.channel_name && counts.set(s.channel_name, (counts.get(s.channel_name) ?? 0) + 1));
    return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
  }, [likedSongs]);

  const visibleSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: LikedSong[] = likedSongs.filter(
      (s) =>
        (!channelFilter || s.channel_name === channelFilter) &&
        (!q || s.title.toLowerCase().includes(q) || (s.channel_name ?? '').toLowerCase().includes(q))
    );
    if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'channel') list = [...list].sort((a, b) => (a.channel_name ?? '').localeCompare(b.channel_name ?? ''));
    return list;
  }, [likedSongs, channelFilter, query, sort]);

  const totalDuration = useMemo(
    () => visibleSongs.reduce((sum, s) => sum + (s.duration_sec ?? 0), 0),
    [visibleSongs]
  );

  const play = async (index: number, shuffle?: boolean) => {
    const song = visibleSongs[index];
    if (!song) return;
    setLoadingId(shuffle ? null : song.id);
    try {
      await playback.playSongs(visibleSongs, index, LIKED_CONTEXT, { shuffle });
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not start playback' });
    } finally {
      setLoadingId(null);
    }
  };

  const handleHeaderPlay = () => {
    if (context?.type === 'liked') {
      void playback.togglePlay();
      return;
    }
    void play(0, shuffleMode !== 'off');
  };

  const toggleShuffle = () => {
    tapHaptic();
    if (context?.type === 'liked') {
      void playback.cycleShuffle();
    } else {
      usePlayerStore.setState({ shuffleMode: shuffleMode === 'off' ? 'shuffle' : 'off' });
    }
  };

  const cycleSort = () => {
    tapHaptic();
    const order: SortKey[] = ['recent', 'title', 'channel'];
    setSort(order[(order.indexOf(sort) + 1) % order.length]);
  };

  const handleMakePlaylist = async () => {
    if (visibleSongs.length === 0 || isMakingPlaylist) return;
    setIsMakingPlaylist(true);
    try {
      const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const name = channelFilter ? `${channelFilter} favourites` : `Liked Songs · ${date}`;
      const playlist = await createPlaylist(name, `Copied from your Liked Songs on ${date}`);
      await addSongsToPlaylist(visibleSongs.map((s) => s.id), playlist.id);
      invalidatePlaylists([playlist.id]);
      Toast.show({ type: 'success', text1: `Created "${name}"` });
      navigation.navigate('Playlist', { playlistId: playlist.id });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not create playlist' });
    } finally {
      setIsMakingPlaylist(false);
    }
  };

  const hero = (
    <View>
      <LinearGradient
        colors={[HERO_TINT, '#000000']}
        locations={[0, 1]}
        style={[styles.hero, { paddingTop: insets.top + 64 }]}
      >
        <Text style={styles.heroTitle}>Liked Songs</Text>
        <Text style={styles.heroMeta}>
          {visibleSongs.length} songs{totalDuration > 0 ? ` · ${formatTotal(totalDuration)}` : ''}
        </Text>
      </LinearGradient>

      {likedSongs.length > 0 ? (
        <>
          {isSearching ? (
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={Colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Find in Liked Songs"
                placeholderTextColor={Colors.textMuted}
                style={styles.searchInput}
                autoFocus
              />
              <Pressable onPress={() => { setQuery(''); setIsSearching(false); }} hitSlop={8}>
                <Text style={styles.searchCancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}

          {topChannels.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {topChannels.map((channel) => {
                const active = channelFilter === channel;
                return (
                  <Pressable
                    key={channel}
                    onPress={() => {
                      tapHaptic();
                      setChannelFilter(active ? null : channel);
                    }}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    {active ? <Ionicons name="close" size={14} color="#FFFFFF" /> : null}
                    <Text style={styles.chipText}>{channel}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <View
            style={styles.actionsRow}
            onLayout={(e) => setAnchorY(e.nativeEvent.layout.y)}
          >
            <Pressable onPress={() => setIsSearching(true)} style={styles.actionIcon} hitSlop={6} accessibilityLabel="Search in Liked Songs">
              <Ionicons name="search" size={22} color={Colors.textSubdued} />
            </Pressable>
            <Pressable onPress={cycleSort} style={styles.sortButton} hitSlop={6}>
              <Ionicons name="swap-vertical" size={16} color={Colors.textSubdued} />
              <Text style={styles.sortText}>{SORT_LABELS[sort]}</Text>
            </Pressable>
            <Pressable onPress={() => void handleMakePlaylist()} style={styles.actionIcon} hitSlop={6} accessibilityLabel="Make this a playlist">
              {isMakingPlaylist ? (
                <ActivityIndicator color={Colors.textSubdued} size="small" />
              ) : (
                <Ionicons name="duplicate-outline" size={22} color={Colors.textSubdued} />
              )}
            </Pressable>
            <View style={styles.flex} />
            <Pressable onPress={toggleShuffle} style={styles.actionIcon} hitSlop={6} accessibilityLabel="Shuffle">
              <Ionicons name="shuffle" size={26} color={shuffleMode === 'off' ? Colors.textSubdued : Colors.secondary} />
            </Pressable>
            <PlayButtonSlot />
          </View>
        </>
      ) : null}
    </View>
  );

  const empty = likedQuery.isLoading ? (
    <ActivityIndicator color={Colors.primary} style={styles.loader} />
  ) : likedSongs.length === 0 ? (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="heart-outline" size={40} color={Colors.secondary} />
      </View>
      <Text style={styles.emptyTitle}>Songs you like will appear here</Text>
      <Text style={styles.emptyBody}>Save songs by tapping the heart icon.</Text>
      <Pressable onPress={() => navigation.navigate('Tabs')} style={styles.emptyButton}>
        <Text style={styles.emptyButtonText}>Find songs</Text>
      </Pressable>
    </View>
  ) : (
    <Text style={styles.noMatch}>No liked songs match your filters.</Text>
  );

  return (
    <View style={styles.container}>
      <FlashList
        data={visibleSongs}
        keyExtractor={(item) => item.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={hero}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        renderItem={({ item, index }) => (
          <SongRow song={item} isLoading={loadingId === item.id} onPress={() => void play(index)} />
        )}
      />

      <CollapsingTopBar
        scrollY={scrollY}
        title="Liked Songs"
        background={HERO_TINT}
        threshold={insets.top + 100}
        onBack={() => navigation.goBack()}
      />
      {likedSongs.length > 0 ? (
        <StickyPlayButton scrollY={scrollY} anchorY={anchorY} isPlaying={isThisPlaying} onPress={handleHeaderPlay} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  hero: {
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.display,
    fontWeight: '700',
  },
  heroMeta: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 6,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
  },
  searchInput: {
    color: Colors.onBackground,
    flex: 1,
    fontSize: TypeScale.small,
    paddingVertical: 8,
  },
  searchCancel: {
    color: Colors.onBackground,
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  chips: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: Colors.primary,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    height: 56,
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  actionIcon: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 36,
  },
  sortButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 4,
  },
  sortText: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  loader: {
    marginTop: 48,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderRadius: 999,
    height: 88,
    justifyContent: 'center',
    marginBottom: 20,
    width: 88,
  },
  emptyTitle: {
    color: Colors.onBackground,
    fontSize: TypeScale.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    marginTop: 24,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  emptyButtonText: {
    color: '#000000',
    fontSize: TypeScale.body,
    fontWeight: '700',
  },
  noMatch: {
    color: Colors.textMuted,
    paddingVertical: 32,
    textAlign: 'center',
  },
});
