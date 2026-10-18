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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import DraggableFlatList, { type RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import Toast from 'react-native-toast-message';
import AnimatedBottomSheet from '../components/AnimatedBottomSheet';
import PlaylistCover from '../components/PlaylistCover';
import SongRow from '../components/SongRow';
import {
  CollapsingTopBar,
  PlayButtonSlot,
  StickyPlayButton,
  useCollapsingHeader,
} from '../components/CollapsingHeader';
import { apiClient } from '../services/apiClient';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlaylist } from '../hooks/usePlaylists';
import { useArtworkColor } from '../hooks/useArtworkColor';
import * as playback from '../services/playbackController';
import {
  addSongToPlaylist,
  invalidatePlaylists,
  removeSongFromPlaylist,
} from '../services/libraryActions';
import { gestureHaptic, successHaptic, tapHaptic } from '../services/haptics';
import type { Song } from '../hooks/useSongs';
import { Colors, TypeScale } from '../constants/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Playlist'>;
type PlaylistSong = Song & { added_at?: string | null };
type SortKey = 'custom' | 'title' | 'channel' | 'added' | 'duration';

const SORT_LABELS: Record<SortKey, string> = {
  custom: 'Custom order',
  title: 'Title',
  channel: 'Channel',
  added: 'Date added',
  duration: 'Duration',
};

function formatTotal(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function sortSongs(songs: PlaylistSong[], sort: SortKey): PlaylistSong[] {
  const copy = [...songs];
  switch (sort) {
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'channel':
      return copy.sort((a, b) => (a.channel_name ?? '').localeCompare(b.channel_name ?? ''));
    case 'added':
      return copy.sort((a, b) => (b.added_at ?? '').localeCompare(a.added_at ?? ''));
    case 'duration':
      return copy.sort((a, b) => (a.duration_sec ?? 0) - (b.duration_sec ?? 0));
    default:
      return copy;
  }
}

export default function PlaylistScreen({ route, navigation }: Props) {
  const { playlistId } = route.params;
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { scrollY, onScrollOffset } = useCollapsingHeader();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [loadingSongId, setLoadingSongId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('custom');
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [anchorY, setAnchorY] = useState(0);
  const [recsSeed, setRecsSeed] = useState(0);

  const context = usePlayerStore((s) => s.context);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const isPinned = useSettingsStore((s) => s.pinnedPlaylistIds.includes(playlistId));
  const hiddenIds = useSettingsStore((s) => s.hiddenYoutubeIds);

  const playlistQuery = usePlaylist(playlistId);
  const playlist = playlistQuery.data;
  const songs = useMemo(() => (playlist?.songs ?? []) as PlaylistSong[], [playlist?.songs]);
  const covers = useMemo(() => songs.map((s) => s.thumbnail_url).filter(Boolean) as string[], [songs]);
  const palette = useArtworkColor(covers[0]);
  const isThisPlaying = context?.type === 'playlist' && context.id === playlistId && isPlaying;

  const visibleSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? songs.filter((s) => s.title.toLowerCase().includes(q) || (s.channel_name ?? '').toLowerCase().includes(q))
      : songs;
    return sortSongs(filtered, sort);
  }, [songs, query, sort]);
  const canReorder = sort === 'custom' && !query.trim();

  const totalDuration = useMemo(() => songs.reduce((sum, s) => sum + (s.duration_sec ?? 0), 0), [songs]);
  const playContext = { type: 'playlist' as const, name: playlist?.name ?? 'Playlist', id: playlistId };

  // "Recommended songs": radio from a couple of this playlist's songs.
  const seedIds = useMemo(() => {
    if (songs.length === 0) return [];
    const picks = [songs[recsSeed % songs.length], songs[(recsSeed * 7 + 3) % songs.length]];
    return [...new Set(picks.map((s) => s.youtube_id))];
  }, [songs, recsSeed]);

  const recsQuery = useQuery({
    queryKey: ['playlist-recs', playlistId, seedIds],
    enabled: seedIds.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const results = await Promise.allSettled(seedIds.map((id) => playback.fetchRadio(id, 15)));
      const seen = new Set(songs.map((s) => s.youtube_id));
      const recs: playback.SongInput[] = [];
      results.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        r.value.forEach((song) => {
          if (!seen.has(song.youtube_id)) {
            seen.add(song.youtube_id);
            recs.push(song);
          }
        });
      });
      return recs;
    },
  });
  const recommendations = (recsQuery.data ?? []).filter((r) => !hiddenIds.includes(r.youtube_id)).slice(0, 8);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
    invalidatePlaylists([playlistId]);
  };

  const play = async (index: number, shuffle?: boolean) => {
    const song = visibleSongs[index];
    if (!song) return;
    if (!shuffle) setLoadingSongId(song.id);
    try {
      await playback.playSongs(visibleSongs, index, playContext, { shuffle, thumbnail: covers[0] });
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not start playlist' });
    } finally {
      setLoadingSongId(null);
    }
  };

  const handleHeaderPlay = () => {
    if (context?.type === 'playlist' && context.id === playlistId) {
      void playback.togglePlay();
      return;
    }
    void play(0, shuffleMode !== 'off');
  };

  const toggleShuffle = () => {
    tapHaptic();
    if (context?.type === 'playlist' && context.id === playlistId) {
      void playback.cycleShuffle();
    } else {
      usePlayerStore.setState({ shuffleMode: shuffleMode === 'off' ? 'shuffle' : 'off' });
    }
  };

  const handleRename = async () => {
    const nextName = nameDraft.trim();
    setIsEditingName(false);
    if (!nextName || !playlist || nextName === playlist.name) return;
    try {
      await apiClient.put(`/playlists/${playlistId}`, { name: nextName });
      refresh();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not rename playlist' });
    }
  };

  const handleRemoveSong = async (songId: string) => {
    try {
      await removeSongFromPlaylist(songId, playlistId);
      refresh();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not remove song' });
    }
  };

  const handleReorder = async (data: PlaylistSong[]) => {
    queryClient.setQueryData(['playlist', playlistId], (old: typeof playlist) => (old ? { ...old, songs: data } : old));
    try {
      await apiClient.put(`/playlists/${playlistId}/songs/reorder`, { song_ids: data.map((s) => s.id) });
      invalidatePlaylists();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not reorder playlist' });
      refresh();
    }
  };

  const handleAddRecommendation = async (song: playback.SongInput) => {
    successHaptic();
    try {
      await addSongToPlaylist(song, playlistId);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['playlist-containing', song.youtube_id] });
      Toast.show({ type: 'success', text1: `Added to ${playlist?.name ?? 'playlist'}` });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not add song' });
    }
  };

  const handleDeletePlaylist = () => {
    setIsMenuVisible(false);
    Alert.alert('Delete playlist', `Delete "${playlist?.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/playlists/${playlistId}`);
            invalidatePlaylists();
            Toast.show({ type: 'success', text1: 'Playlist deleted' });
            navigation.goBack();
          } catch {
            Toast.show({ type: 'error', text1: 'Could not delete playlist' });
          }
        },
      },
    ]);
  };

  const cycleSort = () => {
    tapHaptic();
    const order: SortKey[] = ['custom', 'title', 'channel', 'added', 'duration'];
    setSort(order[(order.indexOf(sort) + 1) % order.length]);
  };

  const goToSearch = () => navigation.navigate('Tabs', { screen: 'Search' });

  const renderSongItem = ({ item, getIndex, drag, isActive }: RenderItemParams<PlaylistSong>) => (
    <ScaleDecorator>
      <View style={{ opacity: isActive ? 0.85 : 1 }}>
        <SongRow
          song={item}
          isLoading={loadingSongId === item.id}
          onPress={() => void play(getIndex() ?? 0)}
          menuOptions={{ playlistId }}
          onLongPress={
            canReorder
              ? () => {
                  gestureHaptic();
                  drag();
                }
              : undefined
          }
          trailing={canReorder ? <Ionicons name="reorder-three" size={22} color={Colors.textMuted} /> : null}
          onSwipeRemove={() => void handleRemoveSong(item.id)}
        />
      </View>
    </ScaleDecorator>
  );

  const header = (
    <View>
      <LinearGradient
        colors={[palette.background, '#000000']}
        style={[styles.hero, { paddingTop: insets.top + 56 }]}
      >
        <PlaylistCover thumbnails={covers} size={200} style={styles.heroCover} />
        {isEditingName ? (
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            onSubmitEditing={() => void handleRename()}
            onBlur={() => void handleRename()}
            style={styles.nameInput}
            autoFocus
            selectTextOnFocus
          />
        ) : (
          <Pressable
            onLongPress={() => {
              setNameDraft(playlist?.name ?? '');
              setIsEditingName(true);
            }}
          >
            <Text numberOfLines={2} style={styles.heroTitle}>{playlist?.name ?? 'Playlist'}</Text>
          </Pressable>
        )}
        {playlist?.description ? <Text style={styles.heroDescription}>{playlist.description}</Text> : null}
        <Text style={styles.heroMeta}>
          {songs.length} songs{totalDuration > 0 ? ` · ${formatTotal(totalDuration)}` : ''}
        </Text>
      </LinearGradient>

      {isSearching ? (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find in playlist"
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            autoFocus
          />
          <Pressable onPress={() => { setQuery(''); setIsSearching(false); }} hitSlop={8}>
            <Text style={styles.searchCancel}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.actionsRow} onLayout={(e) => setAnchorY(e.nativeEvent.layout.y)}>
        <Pressable onPress={goToSearch} style={styles.actionIcon} hitSlop={6} accessibilityLabel="Add songs">
          <Ionicons name="add-circle-outline" size={24} color={Colors.textSubdued} />
        </Pressable>
        {songs.length > 0 ? (
          <>
            <Pressable onPress={() => setIsSearching(true)} style={styles.actionIcon} hitSlop={6} accessibilityLabel="Search in playlist">
              <Ionicons name="search" size={22} color={Colors.textSubdued} />
            </Pressable>
            <Pressable onPress={cycleSort} style={styles.sortButton} hitSlop={6}>
              <Ionicons name="swap-vertical" size={16} color={Colors.textSubdued} />
              <Text style={styles.sortText}>{SORT_LABELS[sort]}</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable onPress={() => setIsMenuVisible(true)} style={styles.actionIcon} hitSlop={6} accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={22} color={Colors.textSubdued} />
        </Pressable>
        <View style={styles.flex} />
        {songs.length > 0 ? (
          <>
            <Pressable onPress={toggleShuffle} style={styles.actionIcon} hitSlop={6} accessibilityLabel="Shuffle">
              <Ionicons name="shuffle" size={26} color={shuffleMode === 'off' ? Colors.textSubdued : Colors.secondary} />
            </Pressable>
            <PlayButtonSlot />
          </>
        ) : null}
      </View>
    </View>
  );

  const footer = (
    <View style={styles.recsSection}>
      {songs.length > 0 ? (
        <>
          <View style={styles.recsHeader}>
            <View>
              <Text style={styles.recsTitle}>Recommended songs</Text>
              <Text style={styles.recsSubtitle}>Based on what's in this playlist</Text>
            </View>
            <Pressable onPress={() => setRecsSeed((n) => n + 1)} hitSlop={8} style={styles.refreshButton}>
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
          </View>
          {recsQuery.isLoading ? (
            <ActivityIndicator color={Colors.primary} style={styles.recsLoader} />
          ) : (
            recommendations.map((song) => (
              <View key={song.youtube_id} style={styles.recRow}>
                <Pressable
                  style={styles.recMain}
                  onPress={() =>
                    void playback
                      .playSongs([song, ...recommendations.filter((r) => r !== song)], 0, {
                        type: 'radio',
                        name: `Recommended for ${playlist?.name ?? 'playlist'}`,
                        id: `recs-${playlistId}`,
                      })
                      .then(() => navigation.navigate('NowPlaying'))
                      .catch(() => Toast.show({ type: 'error', text1: 'Could not play this track' }))
                  }
                >
                  <Image source={{ uri: song.thumbnail_url ?? undefined }} style={styles.recThumb} contentFit="cover" />
                  <View style={styles.recMeta}>
                    <Text numberOfLines={1} style={styles.recTitle}>{song.title}</Text>
                    <Text numberOfLines={1} style={styles.recSubtitle}>{song.channel_name}</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => void handleAddRecommendation(song)} hitSlop={8} style={styles.recAdd} accessibilityLabel={`Add ${song.title}`}>
                  <Ionicons name="add-circle-outline" size={26} color={Colors.onBackground} />
                </Pressable>
              </View>
            ))
          )}
        </>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="musical-notes-outline" size={48} color={Colors.primaryLight} />
          <Text style={styles.emptyTitle}>Let's find something for your playlist</Text>
          <Pressable onPress={goToSearch} style={styles.emptyButton}>
            <Text style={styles.emptyButtonText}>Find songs</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  if (playlistQuery.isLoading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <DraggableFlatList
        data={visibleSongs}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => void handleReorder(data)}
        renderItem={renderSongItem}
        onScrollOffsetChange={onScrollOffset}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
      />

      <CollapsingTopBar
        scrollY={scrollY}
        title={playlist?.name ?? 'Playlist'}
        background={palette.muted}
        threshold={insets.top + 300}
        onBack={() => navigation.goBack()}
      />
      {songs.length > 0 ? (
        <StickyPlayButton scrollY={scrollY} anchorY={anchorY} isPlaying={isThisPlaying} onPress={handleHeaderPlay} />
      ) : null}

      <AnimatedBottomSheet isVisible={isMenuVisible} onClose={() => setIsMenuVisible(false)}>
        <View style={styles.menu}>
          <View style={styles.menuHeader}>
            <PlaylistCover thumbnails={covers} size={48} />
            <Text numberOfLines={1} style={styles.menuTitle}>{playlist?.name}</Text>
          </View>
          <MenuRow
            icon="create-outline"
            label="Rename"
            onPress={() => {
              setIsMenuVisible(false);
              setNameDraft(playlist?.name ?? '');
              setIsEditingName(true);
            }}
          />
          <MenuRow
            icon={isPinned ? 'pin' : 'pin-outline'}
            label={isPinned ? 'Unpin playlist' : 'Pin playlist'}
            onPress={() => {
              useSettingsStore.getState().togglePinnedPlaylist(playlistId);
              setIsMenuVisible(false);
              Toast.show({ type: 'success', text1: isPinned ? 'Unpinned' : 'Pinned to the top of Your Library' });
            }}
          />
          <MenuRow
            icon="add-circle-outline"
            label="Add songs"
            onPress={() => {
              setIsMenuVisible(false);
              goToSearch();
            }}
          />
          <MenuRow icon="trash-outline" label="Delete playlist" destructive onPress={handleDeletePlaylist} />
        </View>
      </AnimatedBottomSheet>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}>
      <Ionicons name={icon} size={22} color={destructive ? Colors.error : 'rgba(255,255,255,0.85)'} />
      <Text style={[styles.menuLabel, destructive && { color: Colors.error }]}>{label}</Text>
    </Pressable>
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
  loadingState: {
    alignItems: 'center',
    backgroundColor: Colors.background,
    flex: 1,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  heroCover: {
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
    textAlign: 'center',
  },
  nameInput: {
    borderBottomColor: Colors.primary,
    borderBottomWidth: 2,
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
    minWidth: 200,
    paddingVertical: 4,
    textAlign: 'center',
  },
  heroDescription: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 6,
    textAlign: 'center',
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
    marginBottom: 4,
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
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
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
  recsSection: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  recsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  recsTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    fontWeight: '700',
  },
  recsSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
  },
  refreshButton: {
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  refreshText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  recsLoader: {
    marginVertical: 24,
  },
  recRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 6,
  },
  recMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  recThumb: {
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  recMeta: {
    flex: 1,
    minWidth: 0,
  },
  recTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
  },
  recSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
  },
  recAdd: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 32,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  emptyButtonText: {
    color: '#000000',
    fontSize: TypeScale.body,
    fontWeight: '700',
  },
  menu: {
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  menuHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  menuTitle: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: TypeScale.body,
    fontWeight: '600',
  },
  menuRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
  menuRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  menuLabel: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
  },
});
