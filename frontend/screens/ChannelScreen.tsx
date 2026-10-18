import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import SongRow from '../components/SongRow';
import {
  CollapsingTopBar,
  PlayButtonSlot,
  StickyPlayButton,
  useCollapsingHeader,
} from '../components/CollapsingHeader';
import { apiClient } from '../services/apiClient';
import * as playback from '../services/playbackController';
import { tapHaptic } from '../services/haptics';
import { useArtworkColor } from '../hooks/useArtworkColor';
import { usePlayerStore } from '../store/playerStore';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors, TypeScale } from '../constants/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Channel'>;

export default function ChannelScreen({ route, navigation }: Props) {
  const { channelName } = route.params;
  const insets = useSafeAreaInsets();
  const { scrollY, onScroll } = useCollapsingHeader();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [anchorY, setAnchorY] = useState(0);
  const [isStartingRadio, setIsStartingRadio] = useState(false);

  const context = usePlayerStore((s) => s.context);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const isThisContext = context?.type === 'channel' && context.id === channelName;

  const { data, isLoading } = useQuery({
    queryKey: ['channel-songs', channelName],
    queryFn: async () => {
      const { data: results } = await apiClient.get<playback.YouTubeResult[]>('/youtube/search', {
        params: { q: channelName, limit: 20 },
      });
      return results;
    },
  });

  // Uploads from this exact channel first; other matches for the name after.
  const songs = useMemo(() => {
    const all = (data ?? []).map(playback.fromYouTube);
    const own = all.filter((s) => s.channel_name === channelName);
    return [...own, ...all.filter((s) => s.channel_name !== channelName)];
  }, [data, channelName]);

  const palette = useArtworkColor(songs[0]?.thumbnail_url);
  const channelContext = { type: 'channel' as const, name: channelName, id: channelName };

  const play = async (index: number, shuffle?: boolean) => {
    const song = songs[index];
    if (!song) return;
    if (!shuffle) setLoadingId(song.youtube_id);
    try {
      await playback.playSongs(songs, index, channelContext, { shuffle, thumbnail: song.thumbnail_url });
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not play this track' });
    } finally {
      setLoadingId(null);
    }
  };

  const handleRadio = async () => {
    if (!songs[0] || isStartingRadio) return;
    setIsStartingRadio(true);
    try {
      await playback.startRadio(songs[0]);
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: 'Could not start radio' });
    } finally {
      setIsStartingRadio(false);
    }
  };

  const toggleShuffle = () => {
    tapHaptic();
    if (isThisContext) void playback.cycleShuffle();
    else usePlayerStore.setState({ shuffleMode: shuffleMode === 'off' ? 'shuffle' : 'off' });
  };

  const header = (
    <View>
      <LinearGradient colors={[palette.background, '#000000']} style={[styles.hero, { paddingTop: insets.top + 56 }]}>
        <View style={[styles.avatar, { backgroundColor: palette.accent }]}>
          <Text style={styles.avatarText}>{channelName.charAt(0).toUpperCase()}</Text>
        </View>
        <Text numberOfLines={2} style={styles.channelTitle}>{channelName}</Text>
        <Text style={styles.channelMeta}>{isLoading ? 'Loading…' : `${songs.length} tracks`}</Text>
      </LinearGradient>

      <View style={styles.actionsRow} onLayout={(e) => setAnchorY(e.nativeEvent.layout.y)}>
        <Pressable onPress={() => void handleRadio()} style={styles.radioButton} disabled={!songs.length}>
          {isStartingRadio ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons name="radio-outline" size={16} color="#FFFFFF" />
          )}
          <Text style={styles.radioText}>Channel radio</Text>
        </Pressable>
        <View style={styles.flex} />
        <Pressable onPress={toggleShuffle} style={styles.actionIcon} hitSlop={6} accessibilityLabel="Shuffle">
          <Ionicons name="shuffle" size={26} color={shuffleMode === 'off' ? Colors.textSubdued : Colors.secondary} />
        </Pressable>
        <PlayButtonSlot />
      </View>

      <Text style={styles.sectionTitle}>Popular</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlashList
        data={songs}
        keyExtractor={(item) => item.youtube_id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        renderItem={({ item, index }) => (
          <SongRow
            song={item}
            index={index + 1}
            isLoading={loadingId === item.youtube_id}
            onPress={() => void play(index)}
            menuOptions={{ hideGoToChannel: item.channel_name === channelName }}
          />
        )}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={Colors.primary} style={styles.loader} />
          ) : (
            <Text style={styles.emptyText}>No songs found for this channel.</Text>
          )
        }
      />

      <CollapsingTopBar
        scrollY={scrollY}
        title={channelName}
        background={palette.muted}
        threshold={insets.top + 200}
        onBack={() => navigation.goBack()}
      />
      {songs.length > 0 ? (
        <StickyPlayButton
          scrollY={scrollY}
          anchorY={anchorY}
          isPlaying={isThisContext && isPlaying}
          onPress={() => (isThisContext ? void playback.togglePlay() : void play(0, shuffleMode !== 'off'))}
        />
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
    alignItems: 'center',
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 999,
    height: 140,
    justifyContent: 'center',
    marginBottom: 16,
    width: 140,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 56,
    fontWeight: '700',
  },
  channelTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.display,
    fontWeight: '700',
    textAlign: 'center',
  },
  channelMeta: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 6,
  },
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    height: 56,
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  radioButton: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  radioText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  actionIcon: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 36,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    fontWeight: '700',
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  loader: {
    marginTop: 48,
  },
  emptyText: {
    color: Colors.textMuted,
    paddingVertical: 32,
    textAlign: 'center',
  },
});
