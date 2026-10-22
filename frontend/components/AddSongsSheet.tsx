import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { FlatList, Keyboard, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNetInfo } from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Toast from '../services/toast';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import SkeletonLoader from './SkeletonLoader';
import Button from './ui/Button';
import CheckMark from './ui/CheckMark';
import EmptyState from './ui/EmptyState';
import Segmented from './ui/Segmented';
import TextField from './ui/TextField';
import Text from './ui/Text';
import Rise from '../motion/Rise';
import { apiClient } from '../services/apiClient';
import { addSongToPlaylist, ensureSongId, invalidatePlaylists, queryKeys, removeSongFromPlaylist } from '../services/libraryActions';
import { successHaptic, tapHaptic } from '../services/haptics';
import { fromYouTube, thumbnailFor, type SongInput, type YouTubeResult } from '../services/playbackController';
import { useLikedSongs } from '../hooks/useLiked';
import { Layout, Motion, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';
import { addedToast, isInPlaylist, likedToOffer, netAddedCount, suggestionsToOffer } from './addSongs/logic';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARS = 2;
const HANDLE_HEIGHT = 24;

type Source = 'suggested' | 'liked';
type IconName = ComponentProps<typeof Ionicons>['name'];

/** The playlist's recommendation query, owned by PlaylistScreen so both share one cache entry. */
export type SuggestedFeed = {
  songs: SongInput[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

type AddSongsSheetProps = {
  isVisible: boolean;
  onClose: () => void;
  playlistId: string;
  playlistName: string;
  /** The playlist's songs as the cache has them right now. */
  playlistSongs: Array<{ id: string; youtube_id: string }>;
  suggested: SuggestedFeed;
  /** Opens with this already typed into the search (e.g. a song the import could not find). */
  initialQuery?: string;
};

type ListView = {
  songs: SongInput[];
  loading: boolean;
  error: boolean;
  retry: () => void;
  empty: { icon: IconName; title: string; body: string };
  needsNetwork: boolean;
};

/**
 * Add songs without leaving the playlist (US-11). Search YouTube or pick from
 * Suggested / Liked Songs; each tap adds immediately and a second tap undoes it.
 * The header counts what was added; one toast on close, never one per song.
 */
export default function AddSongsSheet({ isVisible, onClose, playlistId, playlistName, playlistSongs, suggested, initialQuery }: AddSongsSheetProps) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const netInfo = useNetInfo();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isOffline = netInfo.isConnected === false;

  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [source, setSource] = useState<Source>('suggested');
  const [initial, setInitial] = useState<ReadonlySet<string>>(new Set());
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [frozenSuggestions, setFrozenSuggestions] = useState<SongInput[] | null>(null);

  const songsRef = useRef(playlistSongs);
  songsRef.current = playlistSongs;
  const songIds = useRef(new Map<string, string>()); // youtube_id -> catalogue id, for undo
  const queue = useRef(new Map<string, Promise<void>>()); // one in-flight change per song
  const bodyRef = useRef<View>(null);

  // Keyboard: lift the sheet by whatever the keyboard actually covers.
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const [lift, setLift] = useState(0);
  const liftRef = useRef(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const top = e.endCoordinates.screenY;
      setKeyboardTop(top);
      // Measure once layout settles: if the window already resized, no extra lift is needed.
      requestAnimationFrame(() => {
        bodyRef.current?.measureInWindow((_x, y, _w, h) => {
          const next = Math.max(0, liftRef.current + (y + h - top));
          liftRef.current = next;
          setLift(next);
        });
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardTop(null);
      liftRef.current = 0;
      setLift(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Open / close resets.
  useEffect(() => {
    if (!isVisible) {
      setText('');
      setDebounced('');
      setOverrides(new Map());
      setFrozenSuggestions(null);
      songIds.current.clear();
      queue.current.clear();
      return;
    }
    const ids = songsRef.current.map((s) => s.youtube_id);
    setInitial(new Set(ids));
    setSource(ids.length > 0 ? 'suggested' : 'liked');
    if (initialQuery) setText(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  // Suggestions are frozen once they arrive, so rows don't reshuffle as the playlist grows.
  useEffect(() => {
    if (isVisible && frozenSuggestions === null && suggested.songs.length > 0) {
      setFrozenSuggestions(suggestionsToOffer(suggested.songs, initial));
    }
  }, [isVisible, frozenSuggestions, suggested.songs, initial]);

  // Search: same endpoint, cache key and debounce as the Search tab.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_SEARCH_CHARS) {
      setDebounced('');
      return;
    }
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const isSearching = text.trim().length >= MIN_SEARCH_CHARS;
  const searchQuery = useQuery({
    queryKey: ['youtube-search', debounced],
    enabled: isVisible && debounced.length >= MIN_SEARCH_CHARS,
    staleTime: 30 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<YouTubeResult[]>('/youtube/search', { params: { q: debounced, limit: 20 }, signal });
      return data;
    },
  });
  const likedQuery = useLikedSongs();

  const base = useMemo(() => new Set(playlistSongs.map((s) => s.youtube_id)), [playlistSongs]);
  const addedCount = netAddedCount(initial, overrides);

  const toggle = useCallback(
    (song: SongInput) => {
      const youtubeId = song.youtube_id;
      const want = !isInPlaylist(youtubeId, base, overrides);
      if (want) successHaptic();
      else tapHaptic();
      setOverrides((current) => new Map(current).set(youtubeId, want));

      // The playlist behind the sheet updates straight away.
      queryClient.setQueryData(queryKeys.playlist(playlistId), (old: { songs?: Array<{ id: string; youtube_id: string }> } | undefined) => {
        if (!old) return old;
        const songs = old.songs ?? [];
        if (!want) return { ...old, songs: songs.filter((s) => s.youtube_id !== youtubeId) };
        if (songs.some((s) => s.youtube_id === youtubeId)) return old;
        return {
          ...old,
          songs: [
            ...songs,
            {
              id: songIds.current.get(youtubeId) ?? youtubeId,
              youtube_id: youtubeId,
              title: song.title,
              channel_name: song.channel_name,
              thumbnail_url: song.thumbnail_url,
              duration_sec: song.duration_sec,
            },
          ],
        };
      });

      const run = async () => {
        try {
          if (want) {
            const songId = await ensureSongId(song);
            songIds.current.set(youtubeId, songId);
            await addSongToPlaylist({ ...song, id: songId }, playlistId); // keeps recId + surface for the engine
          } else {
            const songId = songIds.current.get(youtubeId) ?? songsRef.current.find((s) => s.youtube_id === youtubeId)?.id;
            if (!songId) throw new Error('unknown song id');
            await removeSongFromPlaylist(songId, playlistId);
          }
        } catch {
          setOverrides((current) => (current.get(youtubeId) === want ? new Map(current).set(youtubeId, !want) : current));
          Toast.show({
            type: 'error',
            text1: want ? `Couldn't add ${song.title}` : `Couldn't remove ${song.title}`,
            text2: 'Check your connection and try again.',
          });
        } finally {
          invalidatePlaylists([playlistId], youtubeId);
        }
      };
      queue.current.set(youtubeId, (queue.current.get(youtubeId) ?? Promise.resolve()).then(run));
    },
    [base, overrides, playlistId, queryClient]
  );

  const finish = useCallback(() => {
    Keyboard.dismiss();
    if (addedCount > 0) {
      successHaptic();
      Toast.show({ type: 'success', text1: addedToast(addedCount, playlistName) });
    }
    onClose();
  }, [addedCount, onClose, playlistName]);

  const searchSongs = useMemo(() => (searchQuery.data ?? []).map(fromYouTube), [searchQuery.data]);
  const likedSongs = useMemo(() => likedToOffer(likedQuery.data, initial) as SongInput[], [likedQuery.data, initial]);

  let view: ListView;
  if (isSearching) {
    view = {
      songs: debounced ? searchSongs : [],
      loading: !debounced || (searchQuery.isLoading && !searchQuery.data),
      error: searchQuery.isError,
      retry: () => void searchQuery.refetch(),
      empty: { icon: 'search', title: `No results for "${text.trim()}"`, body: 'Check the spelling, or try a singer or a film.' },
      needsNetwork: true,
    };
  } else if (source === 'suggested') {
    view = {
      songs: frozenSuggestions ?? [],
      loading: frozenSuggestions === null && suggested.isLoading,
      error: frozenSuggestions === null && suggested.isError,
      retry: suggested.refetch,
      empty:
        initial.size === 0
          ? { icon: 'musical-notes-outline', title: 'Suggestions start with one song', body: 'Add a song from Liked Songs or search, and picks for this playlist appear here.' }
          : { icon: 'sparkles-outline', title: 'No new suggestions right now', body: 'Search for a song, or pick from Liked Songs.' },
      needsNetwork: true,
    };
  } else {
    view = {
      songs: likedSongs,
      loading: likedQuery.isLoading && !likedQuery.data,
      error: likedQuery.isError && !likedQuery.data,
      retry: () => void likedQuery.refetch(),
      empty:
        (likedQuery.data ?? []).length === 0
          ? { icon: 'heart-outline', title: 'No liked songs yet', body: 'Tap the heart on any song and it shows up here.' }
          : { icon: 'checkmark-done-outline', title: 'All your liked songs are in', body: 'Everything you have liked is already in this playlist.' },
      needsNetwork: false,
    };
  }

  const showOffline = isOffline && view.needsNetwork && view.songs.length === 0;

  // Fixed body height so the list scrolls inside it; shrinks to sit above the keyboard.
  const maxBody = screenHeight * 0.88 - HANDLE_HEIGHT - insets.bottom;
  const bodyHeight =
    keyboardTop === null
      ? maxBody
      : Math.max(
          240,
          Math.min(maxBody, keyboardTop - insets.top - HANDLE_HEIGHT - Space[2], screenHeight * 0.88 - HANDLE_HEIGHT - (screenHeight - keyboardTop))
        );

  const renderRow = ({ item, index }: { item: SongInput; index: number }) => (
    <Rise index={index} play={index < Motion.staggerMax}>
      <AddRow song={item} added={isInPlaylist(item.youtube_id, base, overrides)} playlistName={playlistName} onToggle={toggle} />
    </Rise>
  );

  let content: ReactNode;
  if (showOffline) {
    content = <EmptyState compact icon="cloud-offline-outline" title="You're offline" body="Reconnect to search or see suggestions. Liked Songs still work." />;
  } else if (view.loading) {
    content = (
      <View style={styles.skeletons}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={styles.skeletonRow}>
            <SkeletonLoader width={Layout.thumb} height={Layout.thumb} />
            <View style={styles.skeletonText}>
              <SkeletonLoader width="70%" height={13} />
              <SkeletonLoader width="40%" height={11} />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (view.error) {
    content = <EmptyState compact icon="cloud-offline-outline" title="That didn't load" body="Check your connection, then try again." actionLabel="Retry" onAction={view.retry} />;
  } else if (view.songs.length === 0) {
    content = <EmptyState compact icon={view.empty.icon} title={view.empty.title} body={view.empty.body} />;
  } else {
    content = (
      <FlatList
        data={view.songs}
        keyExtractor={(item) => item.youtube_id}
        renderItem={renderRow}
        extraData={overrides}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        contentContainerStyle={{ paddingBottom: Space[4] }}
        style={styles.list}
      />
    );
  }

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={finish}>
      <View ref={bodyRef} collapsable={false} style={[styles.body, { height: bodyHeight, marginBottom: lift }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="title" numberOfLines={1} accessibilityRole="header">{`Add to ${playlistName}`}</Text>
            {addedCount > 0 ? (
              <Text variant="mono" color="accentInk" tabular accessibilityLiveRegion="polite">{`${addedCount} added`}</Text>
            ) : null}
          </View>
          <Button label="Done" size="sm" onPress={finish} />
        </View>

        <View style={styles.search}>
          <TextField
            label="Find songs"
            icon="search"
            value={text}
            onChangeText={setText}
            placeholder="Songs, singers, channels"
            autoCorrect={false}
            autoFocus={false}
            returnKeyType="search"
          />
        </View>

        {!isSearching ? (
          <View style={styles.segmented}>
            <Segmented
              options={[
                { value: 'suggested', label: 'Suggested' },
                { value: 'liked', label: 'Liked Songs' },
              ]}
              value={source}
              onChange={setSource}
            />
          </View>
        ) : null}

        <View style={styles.content}>{content}</View>
      </View>
    </AnimatedBottomSheet>
  );
}

type AddRowProps = { song: SongInput; added: boolean; playlistName: string; onToggle: (song: SongInput) => void };

function AddRow({ song, added, playlistName, onToggle }: AddRowProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      onPress={() => onToggle(song)}
      accessibilityRole="button"
      accessibilityLabel={added ? `Remove ${song.title} from ${playlistName}` : `Add ${song.title} to ${playlistName}`}
      accessibilityState={{ selected: added }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <Image source={{ uri: song.thumbnail_url || thumbnailFor(song.youtube_id) }} style={styles.thumb} contentFit="cover" transition={150} />
      <View style={styles.meta}>
        <Text variant="bodyStrong" numberOfLines={1}>{song.title}</Text>
        {song.channel_name ? <Text variant="caption" color="textSecondary" numberOfLines={1}>{song.channel_name}</Text> : null}
      </View>
      <View style={styles.control}>
        <CheckMark checked={added} size={26} />
        {!added ? <Ionicons name="add" size={18} color={colors.textSecondary} style={styles.plus} /> : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  body: { paddingHorizontal: Space[3] },
  header: { alignItems: 'center', flexDirection: 'row', gap: Space[3], marginBottom: Space[3], paddingHorizontal: Space[2] },
  headerText: { flex: 1, gap: 2, minWidth: 0 },
  search: { marginBottom: Space[3], paddingHorizontal: Space[2] },
  segmented: { marginBottom: Space[2], paddingHorizontal: Space[2] },
  content: { flex: 1 },
  list: { flex: 1 },
  row: { alignItems: 'center', borderRadius: Radius.sm, flexDirection: 'row', gap: Space[3], minHeight: Layout.rowHeight, paddingHorizontal: Space[2], paddingVertical: Space[2] },
  thumb: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.sm, height: Layout.thumb, width: Layout.thumb },
  meta: { flex: 1, gap: 2, minWidth: 0 },
  control: { alignItems: 'center', height: Layout.touchTarget, justifyContent: 'center', width: Layout.touchTarget },
  plus: { position: 'absolute' },
  skeletons: { gap: Space[2], paddingTop: Space[2] },
  skeletonRow: { flexDirection: 'row', gap: Space[3], paddingHorizontal: Space[2], paddingVertical: Space[1] },
  skeletonText: { flex: 1, gap: Space[2], justifyContent: 'center' },
}));
