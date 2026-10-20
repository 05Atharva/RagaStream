import React, { useMemo, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
import { Brand, Layout, Radius, Space, Type } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type Props = BottomTabScreenProps<BottomTabParamList, 'Library'>;
type Filter = 'playlists' | 'channels' | null;

type LibraryItem =
  | { kind: 'liked'; key: string; name: string; count: number }
  | { kind: 'playlist'; key: string; name: string; playlist: Playlist; pinned: boolean; recency: number; added: number }
  | { kind: 'channel'; key: string; name: string; thumbnail?: string | null; count: number; recency: number };

const BENTO_ROW = 84;
const BENTO_GAP = Space[3];
const BENTO_WIDTH = Dimensions.get('window').width - Layout.gutter * 2;
const HALF = (BENTO_WIDTH - BENTO_GAP) / 2;
const SCRIM = [`${Brand.ink}00`, `${Brand.ink}E6`] as const;

type Row = { t: 'letter'; key: string; letter: string } | { t: 'item'; key: string; item: LibraryItem };
type Tile =
  | { kind: 'playlist'; key: string; playlist: Playlist }
  | { kind: 'channel'; key: string; name: string; thumbnail?: string | null; count: number }
  | { kind: 'new'; key: string };

const songs = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;

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
  const pinnedIds = useSettingsStore((s) => s.pinnedPlaylistIds);
  const recentContexts = useSettingsStore((s) => s.recentContexts);
  const setLibrarySort = useSettingsStore((s) => s.setLibrarySort);
  const togglePinned = useSettingsStore((s) => s.togglePinnedPlaylist);

  const playlistsQuery = usePlaylists();
  const likedQuery = useLikedSongs();
  const likedSongs = likedQuery.data ?? [];

  const alphabetical = librarySort === 'alphabetical';

  const { playlistItems, channelItems } = useMemo(() => {
    const playedAt = new Map(recentContexts.map((c) => [`${c.type}:${c.id}`, c.playedAt]));
    const playlistItems = (playlistsQuery.data ?? []).map((playlist) => ({
      kind: 'playlist' as const,
      key: `playlist-${playlist.id}`,
      name: playlist.name,
      playlist,
      pinned: pinnedIds.includes(playlist.id),
      recency: Math.max(playedAt.get(`playlist:${playlist.id}`) ?? 0, Date.parse(playlist.updated_at ?? '') || 0),
      added: Date.parse(playlist.created_at ?? '') || 0,
    }));

    // Channels you've liked songs from: the "Artists" of a YouTube library.
    const channelMap = new Map<string, { count: number; thumbnail?: string | null }>();
    likedSongs.forEach((song) => {
      if (!song.channel_name) return;
      const entry = channelMap.get(song.channel_name);
      channelMap.set(song.channel_name, { count: (entry?.count ?? 0) + 1, thumbnail: entry?.thumbnail ?? song.thumbnail_url });
    });
    const channelItems = [...channelMap.entries()].map(([name, v]) => ({
      kind: 'channel' as const,
      key: `channel-${name}`,
      name,
      thumbnail: v.thumbnail,
      count: v.count,
      recency: playedAt.get(`channel:${name}`) ?? 0,
    }));
    return { playlistItems, channelItems };
  }, [playlistsQuery.data, likedSongs, recentContexts, pinnedIds]);

  // Bento: pinned playlists first, then most recent; the channel with the most liked songs.
  const tiles = useMemo<Tile[]>(() => {
    const top = [...playlistItems]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.recency - a.recency)
      .slice(0, 3)
      .map<Tile>((p) => ({ kind: 'playlist', key: p.key, playlist: p.playlist }));
    const channel = [...channelItems].sort((a, b) => b.count - a.count)[0];
    return [
      ...top,
      { kind: 'new', key: 'new' },
      ...(channel ? [{ kind: 'channel' as const, key: channel.key, name: channel.name, thumbnail: channel.thumbnail, count: channel.count }] : []),
    ];
  }, [playlistItems, channelItems]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    let list: LibraryItem[] = filter === 'playlists' ? playlistItems : filter === 'channels' ? channelItems : [...playlistItems, ...channelItems];
    if (q) list = list.filter((item) => item.name.toLowerCase().includes(q));
    const showLiked = filter !== 'channels' && (!q || 'liked songs'.includes(q));
    const liked: LibraryItem = { kind: 'liked', key: 'liked', name: 'Liked Songs', count: likedSongs.length };

    if (alphabetical) {
      const sorted = [...(showLiked ? [liked, ...list] : list)].sort((a, b) => a.name.localeCompare(b.name));
      const out: Row[] = [];
      let last = '';
      sorted.forEach((item) => {
        const first = item.name.trim().charAt(0).toUpperCase();
        const letter = /[A-Z]/.test(first) ? first : '#';
        if (letter !== last) {
          out.push({ t: 'letter', key: `letter-${letter}`, letter });
          last = letter;
        }
        out.push({ t: 'item', key: item.key, item });
      });
      return out;
    }

    const value = (item: LibraryItem) =>
      item.kind === 'playlist' ? (librarySort === 'added' ? item.added : item.recency) : item.kind === 'channel' ? item.recency : 0;
    list = [...list].sort((a, b) => value(b) - value(a));
    list = [...list.filter((i) => i.kind === 'playlist' && i.pinned), ...list.filter((i) => !(i.kind === 'playlist' && i.pinned))];
    return (showLiked ? [liked, ...list] : list).map((item) => ({ t: 'item', key: item.key, item }));
  }, [playlistItems, channelItems, likedSongs.length, filter, query, librarySort, alphabetical]);

  const openItem = (item: LibraryItem) => {
    if (item.kind === 'liked') root?.navigate('LikedSongs');
    else if (item.kind === 'playlist') root?.navigate('Playlist', { playlistId: item.playlist.id });
    else root?.navigate('Channel', { channelName: item.name });
  };

  const chooseSort = (next: LibrarySort) => {
    if ((next === 'alphabetical') === alphabetical) return;
    tapHaptic();
    setLibrarySort(next);
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

  const metaFor = (item: LibraryItem) =>
    item.kind === 'liked'
      ? `Liked Songs · ${songs(item.count)}`
      : item.kind === 'playlist'
        ? `Playlist · ${songs(item.playlist.song_count ?? 0)}`
        : `Channel · ${item.count} liked ${item.count === 1 ? 'song' : 'songs'}`;

  const openPlaylist = (playlist: Playlist) => root?.navigate('Playlist', { playlistId: playlist.id });
  const openCreate = () => {
    tapHaptic();
    setIsCreateVisible(true);
  };

  const ART = 52;
  const art = (item: LibraryItem) => {
    if (item.kind === 'liked') return <PlaylistCover variant="liked" size={ART} borderRadius={Radius.sm} />;
    if (item.kind === 'playlist') return <PlaylistCover thumbnails={item.playlist.cover_thumbnails} size={ART} borderRadius={Radius.sm} />;
    return <Image source={{ uri: item.thumbnail ?? undefined }} style={{ backgroundColor: colors.surfaceRaised, borderRadius: Radius.pill, height: ART, width: ART }} contentFit="cover" />;
  };

  const renderRow = ({ item: row, index }: { item: Row; index: number }) => {
    if (row.t === 'letter') {
      return <Text variant="display" color="textTertiary" style={styles.letter} accessibilityRole="header">{row.letter}</Text>;
    }
    const item = row.item;
    const pinned = item.kind === 'playlist' && item.pinned;
    const tag = item.kind === 'liked' ? null : item.kind === 'playlist' ? 'PL' : 'CH';
    return (
      <Rise play={firstMount} index={index}>
        <Tappable style={styles.row} pressScale={0.985} onPress={() => openItem(item)}
          onLongPress={item.kind === 'playlist' ? () => setMenuPlaylist(item.playlist) : undefined}
          accessibilityRole="button" accessibilityLabel={`${item.name}, ${metaFor(item)}${pinned ? ', pinned' : ''}`}>
          {art(item)}
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="subtitle" numberOfLines={1}>{item.name}</Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>{metaFor(item)}</Text>
          </View>
          <View style={styles.tagColumn}>
            {pinned ? <Ionicons name="pin" size={12} color={colors.accentInk} /> : null}
            {tag ? <Text variant="mono" color="textTertiary">{tag}</Text> : <Ionicons name="heart" size={13} color={colors.textTertiary} />}
          </View>
        </Tappable>
      </Rise>
    );
  };

  // Bento tiles
  const renderTile = (tile: Tile, width: number, index: number) => {
    const style = [styles.tile, { height: BENTO_ROW, width }];
    if (tile.kind === 'new') {
      return (
        <Rise key={tile.key} play={firstMount} index={index}>
          <Tappable style={[...style, styles.newTile]} pressScale={0.97} onPress={openCreate} accessibilityRole="button" accessibilityLabel="New playlist">
            <Ionicons name="add" size={22} color={colors.accentInk} />
            <Text variant="captionStrong" numberOfLines={1}>New playlist</Text>
          </Tappable>
        </Rise>
      );
    }
    const isChannel = tile.kind === 'channel';
    const name = isChannel ? tile.name : tile.playlist.name;
    const meta = isChannel ? `Top channel · ${tile.count} liked` : songs(tile.playlist.song_count ?? 0);
    const artHeight = Math.max(width, BENTO_ROW);
    return (
      <Rise key={tile.key} play={firstMount} index={index}>
        <Tappable
          style={style}
          pressScale={0.97}
          onPress={() => (isChannel ? root?.navigate('Channel', { channelName: tile.name }) : openPlaylist(tile.playlist))}
          onLongPress={isChannel ? undefined : () => setMenuPlaylist(tile.playlist)}
          accessibilityRole="button"
          accessibilityLabel={`${name}, ${meta}`}>
          <View style={[styles.tileArt, { height: artHeight, top: -(artHeight - BENTO_ROW) / 2 }]}>
            {isChannel ? (
              <Image source={{ uri: tile.thumbnail ?? undefined }} style={{ height: '100%', width: '100%' }} contentFit="cover" />
            ) : (
              <PlaylistCover thumbnails={tile.playlist.cover_thumbnails} size={width} borderRadius={0} />
            )}
          </View>
          <LinearGradient colors={SCRIM} style={styles.scrim} />
          <View style={styles.tileText}>
            <Text variant="captionStrong" color="#FFFFFF" numberOfLines={1}>{name}</Text>
            <Text variant="caption" color="#FFFFFF" numberOfLines={1} style={{ opacity: 0.8 }}>{meta}</Text>
          </View>
        </Tappable>
      </Rise>
    );
  };

  const bento = () => {
    // Liked Songs spans two rows on the left; the first two other tiles stack beside it.
    const sideTiles = tiles.slice(0, 2);
    const rest = tiles.slice(2);
    const restRows: Tile[][] = [];
    rest.forEach((t) => {
      const last = restRows[restRows.length - 1];
      if (t.kind === 'channel' || !last || last.length === 2 || last[0].kind === 'channel') restRows.push([t]);
      else last.push(t);
    });
    let n = 1;
    return (
      <View style={{ gap: BENTO_GAP, marginBottom: Space[6] }}>
        <Text variant="headline">Your collection</Text>
        <View style={{ flexDirection: 'row', gap: BENTO_GAP }}>
          <Rise play={firstMount} index={0}>
            <Tappable style={[styles.tile, { height: BENTO_ROW * 2 + BENTO_GAP, width: HALF }]} pressScale={0.97}
              onPress={() => root?.navigate('LikedSongs')} accessibilityRole="button"
              accessibilityLabel={`Liked Songs, ${songs(likedSongs.length)}`}>
              <LinearGradient colors={[Brand.kesar, Brand.neelDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill} />
              <View style={styles.likedText}>
                <Ionicons name="heart" size={28} color="#FFFFFF" />
                <View>
                  <Text variant="subtitle" color="#FFFFFF">Liked Songs</Text>
                  <Text variant="caption" color="#FFFFFF" style={{ opacity: 0.85 }}>{songs(likedSongs.length)}</Text>
                </View>
              </View>
            </Tappable>
          </Rise>
          <View style={{ gap: BENTO_GAP }}>{sideTiles.map((t) => renderTile(t, HALF, n++))}</View>
        </View>
        {restRows.map((r) => (
          <View key={r.map((t) => t.key).join('|')} style={{ flexDirection: 'row', gap: BENTO_GAP }}>
            {r.map((t) => renderTile(t, r.length === 1 ? BENTO_WIDTH : HALF, n++))}
          </View>
        ))}
      </View>
    );
  };

  const listHeader = (
    <View>
      {!query ? bento() : null}
      {!query ? <Text variant="headline" style={{ marginBottom: Space[3] }}>Everything</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
        <Chip label="All" selected={filter === null} onPress={() => setFilter(null)} />
        <Chip label="Playlists" selected={filter === 'playlists'} onPress={() => setFilter(filter === 'playlists' ? null : 'playlists')} />
        <Chip label="Channels" selected={filter === 'channels'} onPress={() => setFilter(filter === 'channels' ? null : 'channels')} />
        <View style={styles.sortGroup}>
          <Chip label="Recents" selected={!alphabetical} onPress={() => chooseSort('recents')} />
          <Chip label="A–Z" selected={alphabetical} onPress={() => chooseSort('alphabetical')} />
        </View>
      </ScrollView>
    </View>
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

      {playlistsQuery.isLoading || likedQuery.isLoading ? (
        <View style={{ gap: Space[3], paddingHorizontal: Layout.gutter }}>
          <SkeletonLoader width="100%" height={BENTO_ROW * 2 + BENTO_GAP} />
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3] }}>
              <SkeletonLoader width={52} height={52} />
              <View style={{ flex: 1, gap: Space[2] }}>
                <SkeletonLoader width="60%" height={14} />
                <SkeletonLoader width="35%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.t}
          renderItem={renderRow}
          ListHeaderComponent={listHeader}
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
  chipScroll: { marginHorizontal: -Layout.gutter },
  chips: { alignItems: 'center', gap: Space[2], paddingBottom: Space[2], paddingHorizontal: Layout.gutter },
  sortGroup: { borderLeftColor: t.colors.border, borderLeftWidth: 1, flexDirection: 'row', gap: Space[2], marginLeft: Space[2], paddingLeft: Space[4] },
  row: { alignItems: 'center', flexDirection: 'row', gap: Space[4], minHeight: Layout.touchTarget + 16, paddingVertical: Space[2] },
  tagColumn: { alignItems: 'center', gap: Space[1], justifyContent: 'center', minWidth: Layout.touchTarget - 12 },
  letter: { paddingBottom: Space[1], paddingTop: Space[4] },
  tile: { borderRadius: Radius.lg, overflow: 'hidden' },
  newTile: { alignItems: 'flex-start', backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: 1, gap: Space[1], justifyContent: 'center', paddingHorizontal: Space[4] },
  tileArt: { left: 0, position: 'absolute', right: 0 },
  scrim: { bottom: 0, height: '75%', left: 0, position: 'absolute', right: 0 },
  tileText: { bottom: Space[3], gap: 1, left: Space[3], position: 'absolute', right: Space[3] },
  fill: { ...StyleSheet.absoluteFillObject },
  likedText: { flex: 1, justifyContent: 'space-between', padding: Space[4] },
  nameInput: {
    ...Type.headline,
    borderBottomColor: t.colors.accent,
    borderBottomWidth: 2,
    color: t.colors.text,
    paddingVertical: Space[2],
    textAlign: 'center',
  },
}));
