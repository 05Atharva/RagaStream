import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from '../services/toast';
import SkeletonLoader from '../components/SkeletonLoader';
import SongRow from '../components/SongRow';
import { CollapsingTopBar, PlayButtonSlot, StickyPlayButton, useCollapsingHeader } from '../components/CollapsingHeader';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import IconButton from '../components/ui/IconButton';
import SectionHeader from '../components/ui/SectionHeader';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import { apiClient } from '../services/apiClient';
import * as playback from '../services/playbackController';
import { tapHaptic } from '../services/haptics';
import { useArtworkColor, useHeroTint } from '../hooks/useArtworkColor';
import { usePlayerStore } from '../store/playerStore';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Elevation, Layout, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Channel'>;

export default function ChannelScreen({ route, navigation }: Props) {
  const { channelName } = route.params;
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { scrollY, onScroll } = useCollapsingHeader();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [anchorY, setAnchorY] = useState(0);
  const [startingRadio, setStartingRadio] = useState(false);

  const context = usePlayerStore((s) => s.context);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const isThisContext = context?.type === 'channel' && context.id === channelName;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['channel-songs', channelName],
    queryFn: async () => (await apiClient.get<playback.YouTubeResult[]>('/youtube/search', { params: { q: channelName, limit: 20 } })).data,
  });

  // This channel's own uploads first, then other matches for the name.
  const songs = useMemo(() => {
    const all = (data ?? []).map(playback.fromYouTube);
    return [...all.filter((s) => s.channel_name === channelName), ...all.filter((s) => s.channel_name !== channelName)];
  }, [data, channelName]);

  const palette = useArtworkColor(songs[0]?.thumbnail_url);
  const tint = useHeroTint(palette);
  const channelContext = { type: 'channel' as const, name: channelName, id: channelName };

  const play = async (index: number, shuffle?: boolean) => {
    const song = songs[index];
    if (!song) return;
    if (!shuffle) setLoadingId(song.youtube_id);
    try {
      await playback.playSongs(songs, index, channelContext, { shuffle, thumbnail: song.thumbnail_url });
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't play this song", text2: 'Try another one.' });
    } finally {
      setLoadingId(null);
    }
  };

  const startRadio = async () => {
    if (!songs[0] || startingRadio) return;
    setStartingRadio(true);
    try {
      await playback.startRadio(songs[0], `${channelName} Radio`);
      navigation.navigate('NowPlaying');
    } catch {
      Toast.show({ type: 'error', text1: "Couldn't start the radio" });
    } finally {
      setStartingRadio(false);
    }
  };

  const toggleShuffle = () => {
    tapHaptic();
    if (isThisContext) void playback.cycleShuffle();
    else usePlayerStore.setState({ shuffleMode: shuffleMode === 'off' ? 'shuffle' : 'off' });
  };

  const header = (
    <View>
      <LinearGradient colors={[tint.top, colors.bg]} style={[styles.hero, { paddingTop: insets.top + 64 }]}>
        <Rise style={[styles.avatar, Elevation.art]}>
          {songs[0]?.thumbnail_url ? (
            <Image source={{ uri: songs[0].thumbnail_url }} style={{ height: '100%', width: '100%' }} contentFit="cover" />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: palette.accent }]}>
              <Text variant="hero" color="#FFFFFF">{channelName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </Rise>
        <Rise index={1} style={{ alignItems: 'center', gap: Space[2] }}>
          <Text variant="display" align="center" numberOfLines={2}>{channelName}</Text>
          <Text variant="mono" color="textSecondary">{isLoading ? 'Finding songs…' : `${songs.length} songs found`}</Text>
        </Rise>
      </LinearGradient>

      <View style={styles.actions} onLayout={(e) => setAnchorY(e.nativeEvent.layout.y)}>
        <Button label="Channel radio" icon="radio-outline" size="sm" variant="outline" onPress={() => void startRadio()} loading={startingRadio} disabled={!songs.length} />
        <View style={{ flex: 1 }} />
        <IconButton icon="shuffle" onPress={toggleShuffle} accessibilityLabel={shuffleMode === 'off' ? 'Shuffle off' : 'Shuffle on'}
          color={shuffleMode === 'off' ? colors.textSecondary : colors.accentInk} iconSize={26} />
        <PlayButtonSlot />
      </View>
      <SectionHeader title="Popular" />
    </View>
  );

  return (
    <View style={styles.root}>
      <FlashList
        data={songs}
        keyExtractor={(item) => item.youtube_id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: insets.bottom + Space[16] }}
        renderItem={({ item, index }) => (
          <SongRow song={item} index={index + 1} isLoading={loadingId === item.youtube_id} onPress={() => void play(index)}
            menuOptions={{ hideGoToChannel: item.channel_name === channelName }} />
        )}
        ListEmptyComponent={
          isLoading ? (
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
          ) : isError ? (
            <EmptyState icon="cloud-offline-outline" title="Couldn't load this channel" body="Check your connection and try again." actionLabel="Try again" onAction={() => void refetch()} compact />
          ) : (
            <EmptyState icon="search" title="No songs found" body="This channel didn't return any music." compact />
          )
        }
      />
      <CollapsingTopBar scrollY={scrollY} title={channelName} background={tint.bar} ink={tint.ink} threshold={insets.top + 230} onBack={() => navigation.goBack()} />
      {songs.length > 0 ? (
        <StickyPlayButton scrollY={scrollY} anchorY={anchorY} isPlaying={isThisContext && isPlaying}
          onPress={() => (isThisContext ? void playback.togglePlay() : void play(0, shuffleMode !== 'off'))} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  hero: { alignItems: 'center', gap: Space[5], paddingBottom: Space[4], paddingHorizontal: Layout.gutter },
  avatar: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.pill, height: 156, overflow: 'hidden', width: 156 },
  avatarFallback: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  actions: { alignItems: 'center', flexDirection: 'row', gap: Space[2], height: 56, marginBottom: Space[4], paddingHorizontal: Layout.gutter },
}));
