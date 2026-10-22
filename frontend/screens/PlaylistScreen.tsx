import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import DraggableFlatList, { type RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import Toast from '../services/toast';
import AddSongsSheet from '../components/AddSongsSheet';
import AnimatedBottomSheet from '../components/AnimatedBottomSheet';
import { confirmModal } from '../components/AppModal';
import PlaylistCover from '../components/PlaylistCover';
import SongRow from '../components/SongRow';
import { CollapsingTopBar, PlayButtonSlot, StickyPlayButton, useCollapsingHeader } from '../components/CollapsingHeader';
import EmptyState from '../components/ui/EmptyState';
import IconButton from '../components/ui/IconButton';
import SectionHeader from '../components/ui/SectionHeader';
import SheetRow from '../components/ui/SheetRow';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import { apiClient } from '../services/apiClient';
import * as recsApi from '../services/recsService';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';
import { usePlaylist } from '../hooks/usePlaylists';
import { useArtworkColor, useHeroTint } from '../hooks/useArtworkColor';
import * as playback from '../services/playbackController';
import { addSongToPlaylist, invalidatePlaylists, removeSongFromPlaylist } from '../services/libraryActions';
import { gestureHaptic, successHaptic, tapHaptic } from '../services/haptics';
import type { Song } from '../hooks/useSongs';
import { Elevation, Layout, Radius, Space, Type } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Playlist'>;
type PlaylistSong = Song & { added_at?: string | null };
type SortKey = 'custom' | 'title' | 'channel' | 'added' | 'duration';

const SORT_LABELS: Record<SortKey, string> = {
  custom: 'Your order',
  title: 'Title',
  channel: 'Channel',
  added: 'Recently added',
  duration: 'Duration',
};

function formatTotal(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function sortSongs(songs: PlaylistSong[], sort: SortKey): PlaylistSong[] {
  const copy = [...songs];
  if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'channel') return copy.sort((a, b) => (a.channel_name ?? '').localeCompare(b.channel_name ?? ''));
  if (sort === 'added') return copy.sort((a, b) => (b.added_at ?? '').localeCompare(a.added_at ?? ''));
  if (sort === 'duration') return copy.sort((a, b) => (a.duration_sec ?? 0) - (b.duration_sec ?? 0));
  return copy;
}

export default function PlaylistScreen({ route, navigation }: Props) {
  const { playlistId } = route.params;
  const styles = useStyles();
  const colors = useColors();
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
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [anchorY, setAnchorY] = useState(0);
  const [recsSeed, setRecsSeed] = useState(0);

  const context = usePlayerStore((s) => s.context);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const isPinned = useSettingsStore((s) => s.pinnedPlaylistIds.includes(playlistId));
  const hiddenIds = useSettingsStore((s) => s.hiddenYoutubeIds);
  const hiddenChannels = useSettingsStore((s) => s.hiddenChannels);

  const playlistQuery = usePlaylist(playlistId);
  const playlist = playlistQuery.data;
  const songs = useMemo(() => (playlist?.songs ?? []) as PlaylistSong[], [playlist?.songs]);
  const covers = useMemo(() => songs.map((s) => s.thumbnail_url).filter(Boolean) as string[], [songs]);
  const tint = useHeroTint(useArtworkColor(covers[0]));
  const isThisContext = context?.type === 'playlist' && context.id === playlistId;

  const visibleSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? songs.filter((s) => s.title.toLowerCase().includes(q) || (s.channel_name ?? '').toLowerCase().includes(q)) : songs;
    return sortSongs(filtered, sort);
  }, [songs, query, sort]);
  const canReorder = sort === 'custom' && !query.trim();
  const totalDuration = useMemo(() => songs.reduce((sum, s) => sum + (s.duration_sec ?? 0), 0), [songs]);
  const playContext = { type: 'playlist' as const, name: playlist?.name ?? 'Playlist', id: playlistId };

  // Recommended songs (US-11): radio from a couple of this playlist's songs.
  const seedIds = useMemo(() => {
    if (!songs.length) return [];
    const picks = [songs[recsSeed % songs.length], songs[(recsSeed * 7 + 3) % songs.length]];
    return [...new Set(picks.map((s) => s.youtube_id))];
  }, [songs, recsSeed]);
  const recsQuery = useQuery({
    queryKey: ['playlist-recs', playlistId, seedIds, recsSeed],
    enabled: seedIds.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      // The engine first; YouTube radio around a couple of songs if it fails.
      try {
        const ids = songs.map((s) => s.youtube_id).slice(-200); // the API takes at most 200
        const slate = await recsApi.fetchPlaylistRecs(ids, ids, 15);
        const fromEngine = recsApi.slateSongs(slate).map((s) => ({ ...s, surface: 'playlist_recs' as const }));
        if (fromEngine.length > 0) return fromEngine;
      } catch {
        // fall through to radio
      }
      const results = await Promise.allSettled(seedIds.map((id) => playback.fetchRadio(id, 15)));
      const seen = new Set(songs.map((s) => s.youtube_id));
      const recs: playback.SongInput[] = [];
      results.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        r.value.forEach((song) => {
          if (!seen.has(song.youtube_id)) {
            seen.add(song.youtube_id);
            recs.push({ ...song, surface: 'playlist_recs' });
          }
        });
      });
      return recs;
    },
  });
  const allRecommendations = (recsQuery.data ?? []).filter(
    (r) => !hiddenIds.includes(r.youtube_id) && !(r.channel_name && hiddenChannels.includes(r.channel_name))
  );
  const recommendations = allRecommendations.slice(0, 8);

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
      Toast.show({ type: 'error', text1: "Couldn't start this playlist", text2: 'Check your connection and try again.' });
    } finally {
      setLoadingSongId(null);
    }
  };

  const handleHeaderPlay = () => (isThisContext ? void playback.togglePlay() : void play(0, shuffleMode !== 'off'));
  const toggleShuffle = () => {
    tapHaptic();
    if (isThisContext) void playback.cycleShuffle();
    else usePlayerStore.setState({ shuffleMode: shuffleMode === 'off' ? 'shuffle' : 'off' });
  };

  const handleRename = async () => {
    const next = nameDraft.trim();
    setIsEditingName(false);
    if (!next || !playlist || next === playlist.name) return;
    try {
      await apiClient.put(`/playlists/${playlistId}`, { name: next });
      refresh();
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't rename the playlist" });
    }
  };

  const handleRemoveSong = async (songId: string) => {
    try {
      await removeSongFromPlaylist(songId, playlistId);
      refresh();
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't remove the song" });
    }
  };

  const handleReorder = async (data: PlaylistSong[]) => {
    queryClient.setQueryData(['playlist', playlistId], (old: typeof playlist) => (old ? { ...old, songs: data } : old));
    try {
      await apiClient.put(`/playlists/${playlistId}/songs/reorder`, { song_ids: data.map((s) => s.id) });
      invalidatePlaylists();
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't save the new order" });
      refresh();
    }
  };

  const handleAddRecommendation = async (song: playback.SongInput) => {
    successHaptic();
    try {
      await addSongToPlaylist(song, playlistId);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['playlist-containing', song.youtube_id] });
      Toast.show({ type: 'success', text1: `Added to ${playlist?.name ?? 'playlist'}`, text2: song.title });
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't add the song" });
    }
  };

  const handleDelete = () => {
    setIsMenuVisible(false);
    confirmModal({
      title: `Delete "${playlist?.name}"?`,
      message: 'This removes the playlist for good. The songs stay in your library.',
      confirmLabel: 'Delete',
      destructive: true,
      icon: 'trash-outline',
      onConfirm: async () => {
        try {
          await apiClient.delete(`/playlists/${playlistId}`);
          invalidatePlaylists();
          Toast.show({ type: 'success', text1: 'Playlist deleted' });
          navigation.goBack();
        } catch {
          Toast.show({ type: 'error', text1: "Couldn't delete the playlist" });
        }
      },
    });
  };

  const cycleSort = () => {
    tapHaptic();
    const order: SortKey[] = ['custom', 'title', 'channel', 'added', 'duration'];
    setSort(order[(order.indexOf(sort) + 1) % order.length]);
  };

  const openAddSongs = () => setIsAddOpen(true);
  const startRename = () => {
    setNameDraft(playlist?.name ?? '');
    setIsEditingName(true);
  };

  const renderSong = ({ item, getIndex, drag, isActive }: RenderItemParams<PlaylistSong>) => (
    <ScaleDecorator activeScale={1.03}>
      <View style={{ opacity: isActive ? 0.9 : 1 }}>
        <SongRow
          song={item}
          isLoading={loadingSongId === item.id}
          onPress={() => void play(getIndex() ?? 0)}
          menuOptions={{ playlistId }}
          onLongPress={canReorder ? () => { gestureHaptic(); drag(); } : undefined}
          trailing={canReorder ? <Ionicons name="reorder-three" size={22} color={colors.textTertiary} /> : null}
          onSwipeRemove={() => void handleRemoveSong(item.id)}
        />
      </View>
    </ScaleDecorator>
  );

  const header = (
    <View>
      <LinearGradient colors={[tint.top, colors.bg]} style={[styles.hero, { paddingTop: insets.top + 64 }]}>
        <Rise>
          <View style={Elevation.art}>
            <PlaylistCover thumbnails={covers} size={212} borderRadius={Radius.lg} />
          </View>
        </Rise>
        <Rise index={1} style={styles.heroText}>
          {isEditingName ? (
            <TextInput value={nameDraft} onChangeText={setNameDraft} onSubmitEditing={() => void handleRename()} onBlur={() => void handleRename()}
              style={styles.nameInput} autoFocus selectTextOnFocus accessibilityLabel="Playlist name" />
          ) : (
            <Pressable onLongPress={startRename} accessibilityHint="Long-press to rename">
              <Text variant="display" align="center" numberOfLines={2}>{playlist?.name ?? 'Playlist'}</Text>
            </Pressable>
          )}
          {playlist?.description ? <Text variant="caption" color="textSecondary" align="center">{playlist.description}</Text> : null}
          <Text variant="mono" color="textSecondary" align="center" tabular>
            {songs.length} {songs.length === 1 ? 'song' : 'songs'}{totalDuration > 0 ? `  ·  ${formatTotal(totalDuration)}` : ''}
          </Text>
        </Rise>
      </LinearGradient>

      {isSearching ? (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textTertiary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Find in this playlist" placeholderTextColor={colors.textTertiary}
            style={styles.searchInput} autoFocus accessibilityLabel="Find in this playlist" />
          <Pressable onPress={() => { setQuery(''); setIsSearching(false); }} hitSlop={10} accessibilityLabel="Close search">
            <Ionicons name="close" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.actions} onLayout={(e) => setAnchorY(e.nativeEvent.layout.y)}>
        <IconButton icon="add-circle-outline" onPress={openAddSongs} accessibilityLabel="Add songs" iconSize={26} color={colors.textSecondary} />
        {songs.length > 0 ? (
          <>
            <IconButton icon="search" onPress={() => setIsSearching(true)} accessibilityLabel="Find in this playlist" color={colors.textSecondary} />
            <Pressable onPress={cycleSort} hitSlop={6} style={styles.sort} accessibilityRole="button" accessibilityLabel={`Sort: ${SORT_LABELS[sort]}`}>
              <Ionicons name="swap-vertical" size={16} color={colors.textSecondary} />
              <Text variant="captionStrong" color="textSecondary">{SORT_LABELS[sort]}</Text>
            </Pressable>
          </>
        ) : null}
        <IconButton icon="ellipsis-horizontal" onPress={() => setIsMenuVisible(true)} accessibilityLabel="Playlist options" color={colors.textSecondary} />
        <View style={{ flex: 1 }} />
        {songs.length > 0 ? (
          <>
            <IconButton icon="shuffle" onPress={toggleShuffle} accessibilityLabel={shuffleMode === 'off' ? 'Shuffle off' : 'Shuffle on'}
              color={shuffleMode === 'off' ? colors.textSecondary : colors.accentInk} iconSize={26} />
            <PlayButtonSlot />
          </>
        ) : null}
      </View>
    </View>
  );

  const footer = songs.length > 0 ? (
    <View style={{ marginTop: Space[8] }}>
      <SectionHeader title="Recommended" subtitle="Based on what's in this playlist" actionLabel="Refresh" onAction={() => setRecsSeed((n) => n + 1)} />
      {recsQuery.isLoading ? (
        <ActivityIndicator color={colors.accentInk} style={{ marginVertical: Space[6] }} />
      ) : (
        recommendations.map((song) => (
          <View key={song.youtube_id} style={styles.recRow}>
            <Pressable style={styles.recMain} accessibilityRole="button" accessibilityLabel={`Play ${song.title}`}
              onPress={() =>
                void playback
                  .playSongs([song, ...recommendations.filter((r) => r !== song)], 0, { type: 'radio', name: `More like ${playlist?.name ?? 'this'}`, id: `recs-${playlistId}` })
                  .then(() => navigation.navigate('NowPlaying'))
                  .catch(() => Toast.show({ type: 'error', text1: "Couldn't play this song" }))
              }>
              <Image source={{ uri: song.thumbnail_url ?? undefined }} style={styles.recThumb} contentFit="cover" />
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text variant="bodyStrong" numberOfLines={1}>{song.title}</Text>
                <Text variant="caption" color="textSecondary" numberOfLines={1}>{song.channel_name}</Text>
              </View>
            </Pressable>
            <IconButton icon="add-circle-outline" onPress={() => void handleAddRecommendation(song)} accessibilityLabel={`Add ${song.title} to playlist`} iconSize={26} />
          </View>
        ))
      )}
    </View>
  ) : (
    <EmptyState icon="musical-notes-outline" title="Let's find something for this playlist" body="Search for songs, or pick from your Liked Songs, without leaving this page." actionLabel="Add songs" onAction={openAddSongs} />
  );

  if (playlistQuery.isLoading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accentInk} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <DraggableFlatList
        data={visibleSongs}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => void handleReorder(data)}
        renderItem={renderSong}
        onScrollOffsetChange={onScrollOffset}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: insets.bottom + Space[16] }}
      />
      <CollapsingTopBar scrollY={scrollY} title={playlist?.name ?? 'Playlist'} background={tint.bar} ink={tint.ink} threshold={insets.top + 330} onBack={() => navigation.goBack()} />
      {songs.length > 0 ? <StickyPlayButton scrollY={scrollY} anchorY={anchorY} isPlaying={isThisContext && isPlaying} onPress={handleHeaderPlay} /> : null}

      <AnimatedBottomSheet isVisible={isMenuVisible} onClose={() => setIsMenuVisible(false)}>
        <View style={{ paddingBottom: Space[3], paddingHorizontal: Space[3] }}>
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], paddingBottom: Space[3], paddingHorizontal: Space[2] }}>
            <PlaylistCover thumbnails={covers} size={52} borderRadius={Radius.sm} />
            <View style={{ flex: 1 }}>
              <Text variant="subtitle" numberOfLines={1}>{playlist?.name}</Text>
              <Text variant="caption" color="textSecondary">{songs.length} songs</Text>
            </View>
          </View>
          <SheetRow label="Rename" icon="create-outline" onPress={() => { setIsMenuVisible(false); startRename(); }} />
          <SheetRow
            label={isPinned ? 'Unpin from Library' : 'Pin to top of Library'}
            icon={isPinned ? 'pin' : 'pin-outline'}
            onPress={() => {
              useSettingsStore.getState().togglePinnedPlaylist(playlistId);
              setIsMenuVisible(false);
              Toast.show({ type: 'success', text1: isPinned ? 'Unpinned' : 'Pinned to the top of your Library' });
            }}
          />
          <SheetRow label="Add songs" icon="add-circle-outline" onPress={() => { setIsMenuVisible(false); openAddSongs(); }} />
          <SheetRow label="Delete playlist" icon="trash-outline" destructive onPress={handleDelete} />
        </View>
      </AnimatedBottomSheet>

      <AddSongsSheet
        isVisible={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        playlistId={playlistId}
        playlistName={playlist?.name ?? 'playlist'}
        playlistSongs={songs}
        suggested={{ songs: allRecommendations, isLoading: recsQuery.isLoading, isError: recsQuery.isError, refetch: () => void recsQuery.refetch() }}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  hero: { alignItems: 'center', gap: Space[5], paddingBottom: Space[4], paddingHorizontal: Layout.gutter },
  heroText: { alignItems: 'center', gap: Space[2] },
  nameInput: { ...Type.display, borderBottomColor: t.colors.accent, borderBottomWidth: 2, color: t.colors.text, minWidth: 220, paddingVertical: Space[1], textAlign: 'center' },
  searchRow: {
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Space[2],
    height: 46,
    marginBottom: Space[2],
    marginHorizontal: Layout.gutter,
    paddingHorizontal: Space[4],
  },
  searchInput: { ...Type.body, color: t.colors.text, flex: 1, height: '100%' },
  actions: { alignItems: 'center', flexDirection: 'row', gap: Space[1], height: 56, marginBottom: Space[2], paddingLeft: Space[3], paddingRight: Layout.gutter },
  sort: { alignItems: 'center', flexDirection: 'row', gap: Space[1], minHeight: Layout.touchTarget, paddingHorizontal: Space[1] },
  recRow: { alignItems: 'center', flexDirection: 'row', gap: Space[2], paddingLeft: Layout.gutter, paddingRight: Space[3], paddingVertical: Space[2] },
  recMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: Space[3] },
  recThumb: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.sm, height: 48, width: 48 },
}));
