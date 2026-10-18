import React, { useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Toast from 'react-native-toast-message';
import AnimatedBottomSheet from '../components/AnimatedBottomSheet';
import PlaylistCover from '../components/PlaylistCover';
import PressableCard from '../components/PressableCard';
import SkeletonLoader from '../components/SkeletonLoader';
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
import { Colors, TypeScale } from '../constants/theme';

type Props = BottomTabScreenProps<BottomTabParamList, 'Library'>;
type Filter = 'playlists' | 'channels' | null;

type LibraryItem =
  | { kind: 'liked'; key: string; name: string; count: number }
  | { kind: 'playlist'; key: string; name: string; playlist: Playlist; pinned: boolean; recency: number; added: number }
  | { kind: 'channel'; key: string; name: string; thumbnail?: string | null; count: number; recency: number };

const SORT_LABELS: Record<LibrarySort, string> = {
  recents: 'Recents',
  added: 'Recently added',
  alphabetical: 'Alphabetical',
};
const GRID_GAP = 12;
const GRID_COLUMNS = 3;
const GRID_SIZE = (Dimensions.get('window').width - 32 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

export default function LibraryScreen({ navigation }: Props) {
  const rootNavigation = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const bottomPadding = useBottomPadding();

  const [filter, setFilter] = useState<Filter>(null);
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
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

    // Channels you've liked songs from — Spotify's "Artists" filter, for YouTube.
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

    let list: LibraryItem[] =
      filter === 'playlists' ? playlistItems : filter === 'channels' ? channelItems : [...playlistItems, ...channelItems];
    if (q) list = list.filter((item) => item.name.toLowerCase().includes(q));

    const sortValue = (item: LibraryItem) => {
      if (librarySort === 'alphabetical') return 0;
      if (item.kind === 'playlist') return librarySort === 'added' ? item.added : item.recency;
      if (item.kind === 'channel') return librarySort === 'added' ? 0 : item.recency;
      return 0;
    };
    list = [...list].sort((a, b) =>
      librarySort === 'alphabetical' ? a.name.localeCompare(b.name) : sortValue(b) - sortValue(a)
    );
    // Pinned playlists float to the top, in sort order.
    list = [
      ...list.filter((i) => i.kind === 'playlist' && i.pinned),
      ...list.filter((i) => !(i.kind === 'playlist' && i.pinned)),
    ];

    const showLiked = filter !== 'channels' && (!q || 'liked songs'.includes(q));
    return showLiked
      ? [{ kind: 'liked', key: 'liked', name: 'Liked Songs', count: likedSongs.length }, ...list]
      : list;
  }, [playlistsQuery.data, likedSongs, recentContexts, pinnedIds, filter, query, librarySort]);

  const openItem = (item: LibraryItem) => {
    if (item.kind === 'liked') rootNavigation?.navigate('LikedSongs');
    else if (item.kind === 'playlist') rootNavigation?.navigate('Playlist', { playlistId: item.playlist.id });
    else rootNavigation?.navigate('Channel', { channelName: item.name });
  };

  const cycleSort = () => {
    tapHaptic();
    const order: LibrarySort[] = ['recents', 'added', 'alphabetical'];
    setLibrarySort(order[(order.indexOf(librarySort) + 1) % order.length]);
  };

  const handleCreate = async () => {
    const name = playlistName.trim();
    if (!name) return;
    try {
      const playlist = await createPlaylist(name);
      setPlaylistName('');
      setIsCreateVisible(false);
      Toast.show({ type: 'success', text1: 'Playlist created' });
      rootNavigation?.navigate('Playlist', { playlistId: playlist.id });
    } catch {
      Toast.show({ type: 'error', text1: 'Could not create playlist' });
    }
  };

  const handleDelete = (playlist: Playlist) => {
    setMenuPlaylist(null);
    Alert.alert('Delete playlist', `Delete "${playlist.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/playlists/${playlist.id}`);
            invalidatePlaylists();
            Toast.show({ type: 'success', text1: 'Playlist deleted' });
          } catch {
            Toast.show({ type: 'error', text1: 'Could not delete playlist' });
          }
        },
      },
    ]);
  };

  const subtitleFor = (item: LibraryItem) => {
    if (item.kind === 'liked') return `Playlist · ${item.count} songs`;
    if (item.kind === 'playlist') return `Playlist · ${item.playlist.song_count ?? 0} songs`;
    return `Channel · ${item.count} liked`;
  };

  const coverFor = (item: LibraryItem, size: number) => {
    if (item.kind === 'liked') return <PlaylistCover variant="liked" size={size} borderRadius={8} />;
    if (item.kind === 'playlist') return <PlaylistCover thumbnails={item.playlist.cover_thumbnails} size={size} borderRadius={8} />;
    return (
      <Image
        source={{ uri: item.thumbnail ?? undefined }}
        style={{ width: size, height: size, borderRadius: 999, backgroundColor: Colors.surfaceElevated }}
        contentFit="cover"
      />
    );
  };

  const renderListItem = ({ item }: { item: LibraryItem }) => (
    <PressableCard
      onPress={() => openItem(item)}
      onLongPress={item.kind === 'playlist' ? () => setMenuPlaylist(item.playlist) : undefined}
      style={styles.listRow}
    >
      {coverFor(item, 56)}
      <View style={styles.listMeta}>
        <Text numberOfLines={1} style={styles.listTitle}>{item.name}</Text>
        <View style={styles.listSubtitleRow}>
          {item.kind === 'liked' || (item.kind === 'playlist' && item.pinned) ? (
            <Ionicons name="pin" size={12} color={Colors.primaryLight} />
          ) : null}
          <Text numberOfLines={1} style={styles.listSubtitle}>{subtitleFor(item)}</Text>
        </View>
      </View>
    </PressableCard>
  );

  const renderGridItem = ({ item }: { item: LibraryItem }) => (
    <PressableCard
      onPress={() => openItem(item)}
      onLongPress={item.kind === 'playlist' ? () => setMenuPlaylist(item.playlist) : undefined}
      style={styles.gridItem}
    >
      {coverFor(item, GRID_SIZE)}
      <Text numberOfLines={1} style={styles.gridTitle}>{item.name}</Text>
      <Text numberOfLines={1} style={styles.gridSubtitle}>{subtitleFor(item)}</Text>
    </PressableCard>
  );

  const isLoading = playlistsQuery.isLoading || likedQuery.isLoading;

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => rootNavigation?.navigate('Settings')} style={styles.avatar} hitSlop={8} accessibilityLabel="Settings">
          <Ionicons name="person" size={16} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.screenTitle}>Your Library</Text>
        <Pressable onPress={() => setIsSearching((v) => !v)} hitSlop={8} style={styles.headerIcon} accessibilityLabel="Search in Your Library">
          <Ionicons name="search" size={22} color="#FFFFFF" />
        </Pressable>
        <Pressable onPress={() => setIsCreateVisible(true)} hitSlop={8} style={styles.headerIcon} accessibilityLabel="Create playlist">
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </Pressable>
      </View>

      {isSearching ? (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search in Your Library"
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            autoFocus
          />
          <Pressable onPress={() => { setQuery(''); setIsSearching(false); }} hitSlop={8}>
            <Ionicons name="close" size={18} color={Colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {/* ── Filter chips ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsScroll}>
        {filter ? (
          <Pressable onPress={() => setFilter(null)} style={styles.chipClear} accessibilityLabel="Clear filters">
            <Ionicons name="close" size={16} color="#FFFFFF" />
          </Pressable>
        ) : null}
        {(['playlists', 'channels'] as const)
          .filter((f) => !filter || filter === f)
          .map((f) => (
            <Pressable
              key={f}
              onPress={() => {
                tapHaptic();
                setFilter(filter === f ? null : f);
              }}
              style={[styles.chip, filter === f && styles.chipActive]}
            >
              <Text style={styles.chipText}>{f === 'playlists' ? 'Playlists' : 'Channels'}</Text>
            </Pressable>
          ))}
      </ScrollView>

      {/* ── Sort + view toggle ── */}
      <View style={styles.sortRow}>
        <Pressable onPress={cycleSort} style={styles.sortButton} hitSlop={6}>
          <Ionicons name="swap-vertical" size={16} color="#FFFFFF" />
          <Text style={styles.sortText}>{SORT_LABELS[librarySort]}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            tapHaptic();
            setLibraryView(libraryView === 'list' ? 'grid' : 'list');
          }}
          hitSlop={8}
          accessibilityLabel={libraryView === 'list' ? 'View as grid' : 'View as list'}
        >
          <Ionicons name={libraryView === 'list' ? 'grid-outline' : 'list-outline'} size={18} color="#FFFFFF" />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.listRow}>
              <SkeletonLoader width={56} height={56} borderRadius={8} />
              <View style={styles.listMeta}>
                <SkeletonLoader width="60%" height={14} borderRadius={8} />
                <SkeletonLoader width="35%" height={12} borderRadius={8} style={{ marginTop: 6 }} />
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
          renderItem={libraryView === 'grid' ? renderGridItem : renderListItem}
          contentContainerStyle={{ paddingBottom: bottomPadding, paddingHorizontal: 16 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {query ? `Couldn't find "${query}"` : filter === 'channels' ? 'No channels yet' : 'Create your first playlist'}
              </Text>
              <Text style={styles.emptyBody}>
                {query
                  ? 'Try searching again using a different spelling or keyword.'
                  : filter === 'channels'
                    ? 'Like songs and their channels will appear here.'
                    : "It's easy, we'll help you."}
              </Text>
              {!query && filter !== 'channels' ? (
                <Pressable onPress={() => setIsCreateVisible(true)} style={styles.emptyButton}>
                  <Text style={styles.emptyButtonText}>Create playlist</Text>
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}

      {/* ── Create playlist sheet ── */}
      <AnimatedBottomSheet isVisible={isCreateVisible} onClose={() => setIsCreateVisible(false)}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Give your playlist a name</Text>
          <TextInput
            value={playlistName}
            onChangeText={setPlaylistName}
            placeholder="My playlist"
            placeholderTextColor={Colors.textMuted}
            style={styles.sheetInput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void handleCreate()}
          />
          <Pressable
            onPress={() => void handleCreate()}
            disabled={!playlistName.trim()}
            style={[styles.createButton, !playlistName.trim() && styles.createButtonDisabled]}
          >
            <Text style={styles.createButtonText}>Create</Text>
          </Pressable>
        </View>
      </AnimatedBottomSheet>

      {/* ── Playlist long-press menu ── */}
      <AnimatedBottomSheet isVisible={!!menuPlaylist} onClose={() => setMenuPlaylist(null)}>
        {menuPlaylist ? (
          <View style={styles.sheet}>
            <View style={styles.menuHeader}>
              <PlaylistCover thumbnails={menuPlaylist.cover_thumbnails} size={48} borderRadius={8} />
              <Text numberOfLines={1} style={styles.menuTitle}>{menuPlaylist.name}</Text>
            </View>
            <Pressable
              style={styles.menuRow}
              onPress={async () => {
                const playlist = menuPlaylist;
                setMenuPlaylist(null);
                try {
                  const { data } = await apiClient.get<Playlist>(`/playlists/${playlist.id}`);
                  await playback.playSongs(data.songs ?? [], 0, { type: 'playlist', name: playlist.name, id: playlist.id }, {
                    thumbnail: playlist.cover_thumbnails?.[0],
                  });
                  rootNavigation?.navigate('NowPlaying');
                } catch {
                  Toast.show({ type: 'error', text1: 'Could not play playlist' });
                }
              }}
            >
              <Ionicons name="play-circle-outline" size={22} color="rgba(255,255,255,0.85)" />
              <Text style={styles.menuLabel}>Play</Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              onPress={() => {
                togglePinned(menuPlaylist.id);
                setMenuPlaylist(null);
              }}
            >
              <Ionicons name={pinnedIds.includes(menuPlaylist.id) ? 'pin' : 'pin-outline'} size={22} color="rgba(255,255,255,0.85)" />
              <Text style={styles.menuLabel}>{pinnedIds.includes(menuPlaylist.id) ? 'Unpin playlist' : 'Pin playlist'}</Text>
            </Pressable>
            <Pressable style={styles.menuRow} onPress={() => handleDelete(menuPlaylist)}>
              <Ionicons name="trash-outline" size={22} color={Colors.error} />
              <Text style={[styles.menuLabel, { color: Colors.error }]}>Delete playlist</Text>
            </Pressable>
          </View>
        ) : null}
      </AnimatedBottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  screenTitle: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: TypeScale.heading,
    fontWeight: '700',
  },
  headerIcon: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
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
  chipsScroll: {
    flexGrow: 0,
  },
  chips: {
    gap: 8,
    paddingHorizontal: 16,
  },
  chip: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: Colors.primary,
  },
  chipClear: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  sortRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sortButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  sortText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  skeletonList: {
    paddingHorizontal: 16,
  },
  listRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
  },
  listMeta: {
    flex: 1,
    minWidth: 0,
  },
  listTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
  },
  listSubtitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
  },
  listSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
  },
  gridItem: {
    marginBottom: 16,
    width: GRID_SIZE,
  },
  gridTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
    marginTop: 6,
  },
  gridSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.caption,
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 48,
  },
  emptyTitle: {
    color: '#FFFFFF',
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
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyButtonText: {
    color: '#000000',
    fontSize: TypeScale.body,
    fontWeight: '700',
  },
  sheet: {
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  sheetInput: {
    borderBottomColor: Colors.primary,
    borderBottomWidth: 2,
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
    marginBottom: 28,
    paddingVertical: 8,
    textAlign: 'center',
  },
  createButton: {
    alignSelf: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 40,
    paddingVertical: 12,
  },
  createButtonDisabled: {
    opacity: 0.4,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
    fontWeight: '700',
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
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
  menuLabel: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
  },
});
