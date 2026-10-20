import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import Toast from '../services/toast';
import { apiClient } from '../services/apiClient';
import * as playback from '../services/playbackController';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import { useBottomPadding } from '../hooks/useBottomPadding';
import { useSettingsStore } from '../store/settingsStore';
import { openSongMenu } from '../store/songMenuStore';
import SongRow from '../components/SongRow';
import SkeletonLoader from '../components/SkeletonLoader';
import Chip from '../components/ui/Chip';
import EmptyState from '../components/ui/EmptyState';
import SectionHeader from '../components/ui/SectionHeader';
import Tappable from '../components/ui/Tappable';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import { useFirstMount } from '../motion/primitives';
import { tapHaptic } from '../services/haptics';
import { Elevation, Layout, Radius, Space, Type } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type Props = BottomTabScreenProps<BottomTabParamList, 'Search'>;
type ResultFilter = 'all' | 'songs' | 'channels';
type Mood = { label: string; query: string; color: string; icon: React.ComponentProps<typeof Ionicons>['name'] };

// Curated mood tiles: hues chosen to sit beside Kesar and Neel, not a rainbow.
const MOODS: Mood[] = [
  { label: 'Bollywood', query: 'Bollywood hits', color: '#D9542A', icon: 'film-outline' },
  { label: 'Classical', query: 'Hindustani classical', color: '#3F5BE0', icon: 'musical-notes-outline' },
  { label: 'Devotional', query: 'Bhajan devotional', color: '#C98216', icon: 'flame-outline' },
  { label: 'Ghazals', query: 'Ghazals', color: '#7048BE', icon: 'moon-outline' },
  { label: 'Sufi', query: 'Sufi songs', color: '#1C8577', icon: 'infinite-outline' },
  { label: 'Folk', query: 'Indian folk songs', color: '#A9532F', icon: 'leaf-outline' },
  { label: 'Punjabi', query: 'Punjabi songs', color: '#C2185B', icon: 'flash-outline' },
  { label: 'Indie', query: 'Indian indie', color: '#2B6C9B', icon: 'headset-outline' },
  { label: 'Lo-fi', query: 'Hindi lofi', color: '#4A5268', icon: 'cafe-outline' },
  { label: 'Coke Studio', query: 'Coke Studio', color: '#B23A48', icon: 'mic-outline' },
];
const FILTERS: Array<{ key: ResultFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'songs', label: 'Songs' },
  { key: 'channels', label: 'Channels' },
];
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARS = 2;
const TILE_WIDTH = (Dimensions.get('window').width - Layout.gutter * 2 - Space[3]) / 2;

function MoodTile({ mood, onPress }: { mood: Mood; onPress: () => void }) {
  return (
    <Tappable onPress={onPress} pressScale={0.96} accessibilityRole="button" accessibilityLabel={`Browse ${mood.label}`}
      style={{ backgroundColor: mood.color, borderRadius: Radius.md, height: 100, overflow: 'hidden', padding: Space[4], width: TILE_WIDTH }}>
      <Text variant="title" color="#FFFFFF">{mood.label}</Text>
      {/* Oversized glyph, cropped by the tile edge and tilted like a glide */}
      <Ionicons name={mood.icon} size={72} color="rgba(255,255,255,0.22)" style={{ bottom: -14, position: 'absolute', right: -10, transform: [{ rotate: '-18deg' }] }} />
    </Tappable>
  );
}

export default function SearchScreen({ route, navigation }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const firstMount = useFirstMount();
  const [searchText, setSearchText] = useState(route.params?.initialQuery ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [focused, setFocused] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const recentSearches = useSettingsStore((s) => s.recentSearches);
  const addRecentSearch = useSettingsStore((s) => s.addRecentSearch);
  const removeRecentSearch = useSettingsStore((s) => s.removeRecentSearch);
  const clearRecentSearches = useSettingsStore((s) => s.clearRecentSearches);

  useEffect(() => {
    if (route.params?.initialQuery) {
      setSearchText(route.params.initialQuery);
      setDebouncedQuery(route.params.initialQuery);
    }
  }, [route.params?.initialQuery]);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const trimmed = searchText.trim();
    if (trimmed.length < MIN_SEARCH_CHARS) {
      setDebouncedQuery('');
      return;
    }
    debounceTimer.current = setTimeout(() => setDebouncedQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchText]);

  useEffect(() => setFilter('all'), [debouncedQuery]);

  const { data: results, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['youtube-search', debouncedQuery],
    enabled: debouncedQuery.length >= MIN_SEARCH_CHARS,
    staleTime: 30 * 60 * 1000, // matches the backend's search cache
    queryFn: async ({ signal }) => {
      const { data } = await apiClient.get<playback.YouTubeResult[]>('/youtube/search', { params: { q: debouncedQuery, limit: 20 }, signal });
      return data;
    },
  });

  const songs = useMemo(() => (results ?? []).map(playback.fromYouTube), [results]);
  const channels = useMemo(() => {
    const counts = new Map<string, { count: number; thumbnail: string | null | undefined }>();
    songs.forEach((s) => {
      if (!s.channel_name) return;
      const entry = counts.get(s.channel_name);
      counts.set(s.channel_name, { count: (entry?.count ?? 0) + 1, thumbnail: entry?.thumbnail ?? s.thumbnail_url });
    });
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count).map(([name, v]) => ({ name, ...v }));
  }, [songs]);

  const handlePlay = async (song: playback.SongInput) => {
    if (loadingId) return;
    setLoadingId(song.youtube_id);
    addRecentSearch(debouncedQuery || searchText);
    try {
      // Play the song; Autoplay continues with similar music afterwards.
      await playback.playSongs([song], 0, { type: 'search', name: `“${debouncedQuery}”` });
      navigation.getParent()?.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: "This song won't play right now", text2: 'Try another result.' });
    } finally {
      setLoadingId(null);
    }
  };

  const openChannel = (channelName: string) => {
    addRecentSearch(debouncedQuery || searchText);
    navigation.getParent()?.navigate('Channel', { channelName });
  };

  const applyQuery = (query: string) => {
    tapHaptic();
    setSearchText(query);
    setDebouncedQuery(query);
  };

  const bottomPadding = useBottomPadding();
  const showDefault = searchText.trim().length < MIN_SEARCH_CHARS;
  const showNoResults = !showDefault && !isLoading && !isFetching && results !== undefined && results.length === 0;
  const topResult = songs[0];

  const resultsHeader = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />)}
      </ScrollView>

      {filter === 'all' && topResult ? (
        <>
          <SectionHeader title="Top result" />
          <Rise style={{ paddingHorizontal: Layout.gutter }}>
            <Tappable style={styles.topCard} pressScale={0.98} onPress={() => void handlePlay(topResult)} onLongPress={() => openSongMenu(topResult)}
              accessibilityRole="button" accessibilityLabel={`Top result: ${topResult.title}, ${topResult.channel_name}`}>
              <Image source={{ uri: topResult.thumbnail_url ?? undefined }} style={styles.topThumb} contentFit="cover" />
              <View style={{ flex: 1, gap: Space[1], minWidth: 0 }}>
                <Text variant="headline" numberOfLines={2}>{topResult.title}</Text>
                <Text variant="caption" color="textSecondary" numberOfLines={1}>Song · {topResult.channel_name}</Text>
              </View>
              <View style={styles.topPlay}>
                {loadingId === topResult.youtube_id ? <ActivityIndicator color={colors.onAccent} /> : <Ionicons name="play" size={20} color={colors.onAccent} style={{ marginLeft: 2 }} />}
              </View>
            </Tappable>
          </Rise>

          {channels.length > 0 ? (
            <View style={{ marginTop: Space[6] }}>
              <SectionHeader title="Channels" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelStrip}>
                {channels.slice(0, 8).map((c) => (
                  <Tappable key={c.name} style={{ alignItems: 'center', gap: Space[2], width: 96 }} onPress={() => openChannel(c.name)} accessibilityRole="button" accessibilityLabel={`Channel ${c.name}`}>
                    <Image source={{ uri: c.thumbnail ?? undefined }} style={styles.channelImage} contentFit="cover" />
                    <Text variant="captionStrong" numberOfLines={2} align="center">{c.name}</Text>
                  </Tappable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={{ marginTop: Space[6] }}>
            <SectionHeader title="Songs" />
          </View>
        </>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Rise play={firstMount} style={styles.header}>
        <Text variant="display">Search</Text>
        <Pressable onPress={() => inputRef.current?.focus()} style={[styles.searchField, focused && styles.searchFieldFocused]}>
          <Ionicons name="search" size={20} color={focused ? colors.text : colors.textTertiary} />
          <TextInput
            ref={inputRef}
            value={searchText}
            onChangeText={setSearchText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => addRecentSearch(searchText)}
            placeholder="Songs, singers, channels"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search"
          />
          {searchText.length > 0 ? (
            <Pressable onPress={() => setSearchText('')} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </Pressable>
      </Rise>

      {showDefault ? (
        <ScrollView contentContainerStyle={{ paddingBottom: bottomPadding }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {recentSearches.length > 0 ? (
            <Rise play={firstMount} index={1} style={{ marginBottom: Space[6] }}>
              <SectionHeader title="Recent" actionLabel="Clear all" onAction={clearRecentSearches} />
              {recentSearches.slice(0, 6).map((recent) => (
                <Pressable key={recent.query} onPress={() => applyQuery(recent.query)} style={({ pressed }) => [styles.recentRow, pressed && { backgroundColor: colors.surfaceRaised }]}
                  accessibilityRole="button" accessibilityLabel={`Search ${recent.query}`}>
                  <Ionicons name="time-outline" size={20} color={colors.textTertiary} />
                  <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{recent.query}</Text>
                  <Pressable onPress={() => removeRecentSearch(recent.query)} hitSlop={12} accessibilityLabel={`Remove ${recent.query} from recent searches`}>
                    <Ionicons name="close" size={18} color={colors.textTertiary} />
                  </Pressable>
                </Pressable>
              ))}
            </Rise>
          ) : null}
          <Rise play={firstMount} index={2}>
            <SectionHeader title="Browse by mood" />
            <View style={styles.moodGrid}>
              {MOODS.map((mood) => <MoodTile key={mood.label} mood={mood} onPress={() => applyQuery(mood.query)} />)}
            </View>
          </Rise>
        </ScrollView>
      ) : isError ? (
        <EmptyState icon="cloud-offline-outline" title="Search didn't go through" body="Check your connection, then try again." actionLabel="Try again" onAction={() => void refetch()} />
      ) : showNoResults ? (
        <ScrollView contentContainerStyle={{ paddingBottom: bottomPadding }}>
          <EmptyState icon="search" title={`No results for "${debouncedQuery}"`} body="Check the spelling, or try a singer's name or a film." />
          <View style={styles.suggestions}>
            {['Arijit Singh', 'Raag Yaman', 'Coke Studio'].map((tag) => <Chip key={tag} label={tag} onPress={() => applyQuery(tag)} />)}
          </View>
        </ScrollView>
      ) : isLoading && !results ? (
        <View style={{ gap: Space[2], paddingTop: Space[2] }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: Space[3], paddingHorizontal: Layout.gutter, paddingVertical: Space[1] }}>
              <SkeletonLoader width={48} height={48} />
              <View style={{ flex: 1, gap: Space[2], justifyContent: 'center' }}>
                <SkeletonLoader width="70%" height={13} />
                <SkeletonLoader width="40%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : filter === 'channels' ? (
        <FlashList
          data={channels}
          keyExtractor={(item) => item.name}
          ListHeaderComponent={resultsHeader}
          contentContainerStyle={{ paddingBottom: bottomPadding }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable onPress={() => openChannel(item.name)} style={({ pressed }) => [styles.channelRow, pressed && { backgroundColor: colors.surfaceRaised }]}
              accessibilityRole="button" accessibilityLabel={`Channel ${item.name}`}>
              <Image source={{ uri: item.thumbnail ?? undefined }} style={styles.channelRowImage} contentFit="cover" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>{item.name}</Text>
                <Text variant="caption" color="textSecondary">Channel · {item.count} {item.count === 1 ? 'song' : 'songs'} here</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
        />
      ) : (
        <FlashList
          data={filter === 'all' ? songs.slice(1) : songs}
          keyExtractor={(item) => item.youtube_id}
          ListHeaderComponent={resultsHeader}
          contentContainerStyle={{ paddingBottom: bottomPadding }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <SongRow song={item} isLoading={loadingId === item.youtube_id} onPress={() => void handlePlay(item)} />}
        />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  header: { gap: Space[4], paddingBottom: Space[4], paddingHorizontal: Layout.gutter, paddingTop: Space[3] },
  searchField: {
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderColor: 'transparent',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: Space[3],
    height: 52,
    paddingHorizontal: Space[4],
    ...(t.isDark ? {} : Elevation.card),
  },
  searchFieldFocused: { borderColor: t.colors.accent },
  searchInput: { ...Type.bodyStrong, color: t.colors.text, flex: 1, height: '100%' },
  recentRow: { alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: 48, paddingHorizontal: Layout.gutter },
  moodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[3], paddingHorizontal: Layout.gutter },
  filters: { gap: Space[2], paddingBottom: Space[4], paddingHorizontal: Layout.gutter },
  topCard: {
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    gap: Space[4],
    padding: Space[4],
    ...(t.isDark ? {} : Elevation.card),
  },
  topThumb: { borderRadius: Radius.sm, height: 88, width: 88 },
  topPlay: { alignItems: 'center', backgroundColor: t.colors.accent, borderRadius: Radius.pill, height: 48, justifyContent: 'center', width: 48 },
  channelStrip: { gap: Space[4], paddingHorizontal: Layout.gutter },
  channelImage: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.pill, height: 88, width: 88 },
  channelRow: { alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: Layout.rowHeight, paddingHorizontal: Layout.gutter },
  channelRowImage: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.pill, height: 52, width: 52 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2], justifyContent: 'center', paddingHorizontal: Layout.gutter },
}));
