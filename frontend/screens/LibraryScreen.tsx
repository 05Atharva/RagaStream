import React, { useMemo, useState } from 'react';
import { Dimensions, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Toast from '../services/toast';
import AnimatedBottomSheet from '../components/AnimatedBottomSheet';
import { confirmModal } from '../components/AppModal';
import PlaylistCover from '../components/PlaylistCover';
import SkeletonLoader from '../components/SkeletonLoader';
import Button from '../components/ui/Button';
import Chip from '../components/ui/Chip';
import EmptyState from '../components/ui/EmptyState';
import IconButton from '../components/ui/IconButton';
import SheetRow from '../components/ui/SheetRow';
import Tappable from '../components/ui/Tappable';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import { useFirstMount } from '../motion/primitives';
import { apiClient } from '../services/apiClient';
import { createPlaylist, invalidatePlaylists } from '../services/libraryActions';
import { tapHaptic } from '../services/haptics';
import * as playback from '../services/playbackController';
import { usePlaylists, type Playlist } from '../hooks/usePlaylists';
import { useLikedSongs } from '../hooks/useLiked';
import { useBottomPadding } from '../hooks/useBottomPadding';
import { useSettingsStore, type LibrarySort } from '../store/settingsStore';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Layout, Radius, Space, Type } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type Props = BottomTabScreenProps<BottomTabParamList, 'Library'>;
type Filter = 'playlists' | 'channels' | null;

type LibraryItem =
  | { kind: 'liked'; key: string; name: string; count: number }
  | { kind: 'playlist'; key: string; name: string; playlist: Playlist; pinned: boolean; recency: number; added: number }
  | { kind: 'channel'; key: string; name: string; thumbnail?: string | null; count: number; recency: number };

const SORT_LABELS: Record<LibrarySort, string> = { recents: 'Recents', added: 'Recently added', alphabetical: 'A–Z' };
const GRID_COLUMNS = 2;
const GRID_GAP = Space[4];
const GRID_SIZE = (Dimensions.get('window').width - Layout.gutter * 2 - GRID_GAP) / GRID_COLUMNS;

export default function LibraryScreen({ navigation }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const firstMount = useFirstMount();
  const root = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const bottomPadding = useBottomPadding();

  const [filter, setFilter] = useState<Filter>(null);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [menuPlaylist, setMenuPlaylist] = useState<Playlist | null>(null);

  const librarySort = useSettingsStore((s) => s.librarySort);
  const libraryView = useSettingsStore((s) => s.libraryView);
  const pinnedIds = useSettingsStore((s) => s.pinnedPlaylistIds);
  const recentContexts = useSettingsStore((s) => s.recentContexts);
  const setLibrarySort = useSettingsStore((s) => s.setLibrarySort);
  const setLibraryView = useSettingsStore((s) => s.setLibraryView);
  const togglePinned = useSettingsStore((s) => s.togglePinnedPlaylist);

  const playlistsQuery = usePlaylists();
  const likedQuery = useLikedSongs();
  const likedSongs = likedQuery.data ?? [];

  const items = useMemo<LibraryItem[]>(() => {
    const playedAt = new Map(recentContexts.map((c) => [`${c.type}:${c.id}`, c.playedAt]));
    const q = query.trim().toLowerCase();

    const playlistItems: LibraryItem[] = (playlistsQuery.data ?? []).map((playlist) => ({
      kind: 'playlist',
      key: `playlist-${playlist.id}`,
      name: playlist.name,
      playlist,
      pinned: pinnedIds.includes(playlist.id),
      recency: Math.max(playedAt.get(`playlist:${playlist.id}`) ?? 0, Date.parse(playlist.updated_at ?? '') || 0),
      added: Date.parse(playlist.created_at ?? '') || 0,
    }));

    // Channels you've liked songs from — the "Artists" of a YouTube library.
    const channelMap = new Map<string, { count: number; thumbnail?: string | null }>();
    likedSongs.forEach((song) => {
      if (!song.channel_name) return;
      const entry = channelMap.get(song.channel_name);
      channelMap.set(song.channel_name, { count: (entry?.count ?? 0) + 1, thumbnail: entry?.thumbnail ?? song.thumbnail_url });
    });
    const channelItems: LibraryItem[] = [...channelMap.entries()].map(([name, v]) => ({
      kind: 'channel',
      key: `channel-${name}`,
      name,
      thumbnail: v.thumbnail,
      count: v.count,
      recency: playedAt.get(`channel:${name}`) ?? 0,
    }));

    let list: LibraryItem[] = filter === 'playlists' ? playlistItems : filter === 'channels' ? channelItems : [...playlistItems, ...channelItems];
    if (q) list = list.filter((item) => item.name.toLowerCase().includes(q));
    const value = (item: LibraryItem) =>
      item.kind === 'playlist' ? (librarySort === 'added' ? item.added : item.recency) : item.kind === 'channel' && librarySort !== 'added' ? item.recency : 0;
    list = [...list].sort((a, b) => (librarySort === 'alphabetical' ? a.name.localeCompare(b.name) : value(b) - value(a)));
    list = [...list.filter((i) => i.kind === 'playlist' && i.pinned), ...list.filter((i) => !(i.kind === 'playlist' && i.pinned))];

    const showLiked = filter !== 'channels' && (!q || 'liked songs'.includes(q));
    return showLiked ? [{ kind: 'liked', key: 'liked', name: 'Liked Songs', count: likedSongs.length }, ...list] : list;
  }, [playlistsQuery.data, likedSongs, recentContexts, pinnedIds, filter, query, librarySort]);

  const openItem = (item: LibraryItem) => {
    if (item.kind === 'liked') root?.navigate('LikedSongs');
    else if (item.kind === 'playlist') root?.navigate('Playlist', { playlistId: item.playlist.id });
    else root?.navigate('Channel', { channelName: item.name });
  };

  const cycleSort = () => {
    tapHaptic();
    const order: LibrarySort[] = ['recents', 'added', 'alphabetical'];
    setLibrarySort(order[(order.indexOf(librarySort) + 1) % order.length]);
  };

  const handleCreate = async () => {
    const name = playlistName.trim();
    if (!name) return;
    setIsCreating(true);
    try {
      const playlist = await createPlaylist(name);
      setPlaylistName('');
      setIsCreateVisible(false);
      root?.navigate('Playlist', { playlistId: playlist.id });
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't create the playlist", text2: 'Check your connection and try again.' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = (playlist: Playlist) => {
    setMenuPlaylist(null);
    confirmModal({
      title: `Delete "${playlist.name}"?`,
      message: 'This removes the playlist for good. The songs stay in your library.',
      confirmLabel: 'Delete',
      destructive: true,
      icon: 'trash-outline',
      onConfirm: async () => {
        try {
          await apiClient.delete(`/playlists/${playlist.id}`);
          invalidatePlaylists();
          Toast.show({ type: 'success', text1: 'Playlist deleted' });
        } catch {
          Toast.show({ type: 'error', text1: "Couldn't delete the playlist", text2: 'Try again in a moment.' });
        }
      },
    });
  };

  const subtitleFor = (item: LibraryItem) =>
    item.kind === 'liked' ? `${item.count} songs` : item.kind === 'playlist' ? `Playlist · ${item.playlist.song_count ?? 0} songs` : `Channel · ${item.count} liked`;

  const coverFor = (item: LibraryItem, size: number) => {
    if (item.kind === 'liked') return <PlaylistCover variant="liked" size={size} borderRadius={Radius.sm} />;
    if (item.kind === 'playlist') return <PlaylistCover thumbnails={item.playlist.cover_thumbnails} size={size} borderRadius={Radius.sm} />;
    return <Image source={{ uri: item.thumbnail ?? undefined }} style={{ backgroundColor: colors.surfaceRaised, borderRadius: Radius.pill, height: size, width: size }} contentFit="cover" />;
  };

  const pinnedMark = (item: LibraryItem) =>
    item.kind === 'liked' || (item.kind === 'playlist' && item.pinned) ? <Ionicons name="pin" size={12} color={colors.accentInk} /> : null;

  const renderItem = ({ item, index }: { item: LibraryItem; index: number }) =>
    libraryView === 'grid' ? (
      <Rise play={firstMount} index={index} style={{ marginBottom: Space[5], width: GRID_SIZE }}>
        <Tappable onPress={() => openItem(item)} onLongPress={item.kind === 'playlist' ? () => setMenuPlaylist(item.playlist) : undefined}
          pressScale={0.97} accessibilityRole="button" accessibilityLabel={`${item.name}, ${subtitleFor(item)}`}>
          {coverFor(item, GRID_SIZE)}
          <View style={{ gap: 2, marginTop: Space[2] }}>
            <Text variant="captionStrong" numberOfLines={1}>{item.name}</Text>
            <View style={styles.subRow}>{pinnedMark(item)}<Text variant="caption" color="textSecondary" numberOfLines={1}>{subtitleFor(item)}</Text></View>
          </View>
        </Tappable>
      </Rise>
    ) : (
      <Rise play={firstMount} index={index}>
        <Tappable style={styles.listRow} pressScale={0.985} onPress={() => openItem(item)}
          onLongPress={item.kind === 'playlist' ? () => setMenuPlaylist(item.playlist) : undefined}
          accessibilityRole="button" accessibilityLabel={`${item.name}, ${subtitleFor(item)}`}>
          {coverFor(item, 60)}
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="subtitle" numberOfLines={1}>{item.name}</Text>
            <View style={styles.subRow}>{pinnedMark(item)}<Text variant="caption" color="textSecondary" numberOfLines={1}>{subtitleFor(item)}</Text></View>
          </View>
        </Tappable>
      </Rise>
    );

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Text variant="display" style={{ flex: 1 }}>Library</Text>
        <IconButton icon="search" onPress={() => setIsSearching((v) => !v)} accessibilityLabel="Search your library" />
        <IconButton icon="add" variant="tonal" onPress={() => setIsCreateVisible(true)} accessibilityLabel="Create playlist" iconSize={26} />
      </View>

      {isSearching ? (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textTertiary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Find in your library" placeholderTextColor={colors.textTertiary}
            style={styles.searchInput} autoFocus accessibilityLabel="Find in your library" />
          <Pressable onPress={() => { setQuery(''); setIsSearching(false); }} hitSlop={10} accessibilityLabel="Close search">
            <Ionicons name="close" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
      ) : null}

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Playlists" selected={filter === 'playlists'} onPress={() => setFilter(filter === 'playlists' ? null : 'playlists')} />
          <Chip label="Channels" selected={filter === 'channels'} onPress={() => setFilter(filter === 'channels' ? null : 'channels')} />
        </ScrollView>
      </View>

      <View style={styles.sortRow}>
        <Pressable onPress={cycleSort} hitSlop={8} style={styles.sortButton} accessibilityRole="button" accessibilityLabel={`Sort by ${SORT_LABELS[librarySort]}`}>
          <Ionicons name="swap-vertical" size={16} color={colors.text} />
          <Text variant="captionStrong">{SORT_LABELS[librarySort]}</Text>
        </Pressable>
        <IconButton
          icon={libraryView === 'list' ? 'grid-outline' : 'list-outline'}
          onPress={() => setLibraryView(libraryView === 'list' ? 'grid' : 'list')}
          accessibilityLabel={libraryView === 'list' ? 'Show as grid' : 'Show as list'}
          iconSize={19}
        />
      </View>

      {playlistsQuery.isLoading || likedQuery.isLoading ? (
        <View style={{ gap: Space[3], paddingHorizontal: Layout.gutter }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3] }}>
              <SkeletonLoader width={60} height={60} />
              <View style={{ flex: 1, gap: Space[2] }}>
                <SkeletonLoader width="60%" height={14} />
                <SkeletonLoader width="35%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlashList
          key={libraryView}
          data={items}
          keyExtractor={(item) => item.key}
          numColumns={libraryView === 'grid' ? GRID_COLUMNS : 1}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: bottomPadding, paddingHorizontal: Layout.gutter }}
          ListEmptyComponent={
            query ? (
              <EmptyState icon="search" title={`Nothing called "${query}"`} body="Try a different spelling or keyword." compact />
            ) : filter === 'channels' ? (
              <EmptyState icon="person-circle-outline" title="No channels yet" body="Like a few songs and the channels behind them will gather here." compact />
            ) : (
              <EmptyState icon="albums-outline" title="Make your first playlist" body="Collect the songs you love for a drive, a mood, or a morning." actionLabel="Create playlist" onAction={() => setIsCreateVisible(true)} />
            )
          }
        />
      )}

      <AnimatedBottomSheet isVisible={isCreateVisible} onClose={() => setIsCreateVisible(false)}>
        <View style={{ gap: Space[5], paddingBottom: Space[6], paddingHorizontal: Space[6] }}>
          <Text variant="headline" align="center">Name your playlist</Text>
          <TextInput value={playlistName} onChangeText={setPlaylistName} placeholder="Sunday drive" placeholderTextColor={colors.textTertiary}
            style={styles.nameInput} autoFocus returnKeyType="done" onSubmitEditing={() => void handleCreate()} accessibilityLabel="Playlist name" />
          <Button label="Create" size="lg" onPress={() => void handleCreate()} disabled={!playlistName.trim()} loading={isCreating} fullWidth />
        </View>
      </AnimatedBottomSheet>

      <AnimatedBottomSheet isVisible={!!menuPlaylist} onClose={() => setMenuPlaylist(null)}>
        {menuPlaylist ? (
          <View style={{ paddingBottom: Space[3], paddingHorizontal: Space[3] }}>
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], paddingBottom: Space[3], paddingHorizontal: Space[2] }}>
              <PlaylistCover thumbnails={menuPlaylist.cover_thumbnails} size={52} borderRadius={Radius.sm} />
              <View style={{ flex: 1 }}>
                <Text variant="subtitle" numberOfLines={1}>{menuPlaylist.name}</Text>
                <Text variant="caption" color="textSecondary">{menuPlaylist.song_count ?? 0} songs</Text>
              </View>
            </View>
            <SheetRow
              label="Play"
              icon="play-circle-outline"
              onPress={async () => {
                const p = menuPlaylist;
                setMenuPlaylist(null);
                try {
                  const { data } = await apiClient.get<Playlist>(`/playlists/${p.id}`);
                  await playback.playSongs(data.songs ?? [], 0, { type: 'playlist', name: p.name, id: p.id }, { thumbnail: p.cover_thumbnails?.[0] });
                  root?.navigate('NowPlaying');
                } catch {
                  Toast.show({ type: 'error', text1: "Couldn't play this playlist" });
                }
              }}
            />
            <SheetRow
              label={pinnedIds.includes(menuPlaylist.id) ? 'Unpin' : 'Pin to top'}
              icon={pinnedIds.includes(menuPlaylist.id) ? 'pin' : 'pin-outline'}
              onPress={() => {
                togglePinned(menuPlaylist.id);
                setMenuPlaylist(null);
              }}
            />
            <SheetRow label="Delete playlist" icon="trash-outline" destructive onPress={() => handleDelete(menuPlaylist)} />
          </View>
        ) : null}
      </AnimatedBottomSheet>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: Space[1], paddingBottom: Space[3], paddingLeft: Layout.gutter, paddingRight: Space[3], paddingTop: Space[3] },
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
  chips: { gap: Space[2], paddingHorizontal: Layout.gutter },
  sortRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingLeft: Layout.gutter, paddingRight: Space[3], paddingVertical: Space[2] },
  sortButton: { alignItems: 'center', flexDirection: 'row', gap: Space[2], minHeight: Layout.touchTarget },
  listRow: { alignItems: 'center', flexDirection: 'row', gap: Space[4], paddingVertical: Space[2] },
  subRow: { alignItems: 'center', flexDirection: 'row', gap: Space[1] },
  nameInput: {
    ...Type.headline,
    borderBottomColor: t.colors.accent,
    borderBottomWidth: 2,
    color: t.colors.text,
    paddingVertical: Space[2],
    textAlign: 'center',
  },
}));
