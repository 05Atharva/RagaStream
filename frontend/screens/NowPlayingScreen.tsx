import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import LikeButton from '../components/LikeButton';
import SleepTimer, { useSleepTimerLabel } from '../components/SleepTimer';
import SpeedSheet, { speedLabel } from '../components/SpeedSheet';
import QueueSheet from '../components/QueueSheet';
import ReconnectingToast from '../components/ReconnectingToast';
import DeckArtwork, { type DeckArtworkHandle } from '../components/player/DeckArtwork';
import MeendSeek from '../components/player/MeendSeek';
import ArcControls from '../components/player/ArcControls';
import { LyricsCard, LyricsView } from '../components/Lyrics';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore, type PlaybackContext } from '../store/playerStore';
import { openSaveSheet, openSongMenu } from '../store/songMenuStore';
import * as playback from '../services/playbackController';
import { setLiked, shareSong } from '../services/libraryActions';
import { successHaptic } from '../services/haptics';
import { useArtworkColor } from '../hooks/useArtworkColor';
import { useIsLiked } from '../hooks/useLiked';
import { useLyrics } from '../hooks/useLyrics';
import { Layout, Motion, Radius, Space, alpha, mix } from '../constants/theme';
import { useColors, useTheme } from '../theme/ThemeProvider';

const CONTEXT_LABELS: Record<PlaybackContext['type'], string> = {
  playlist: 'Playing from playlist',
  liked: 'Playing from your library',
  search: 'Playing from search',
  channel: 'Playing from channel',
  home: 'Playing from Home',
  radio: 'Playing from radio',
  queue: 'Playing from queue',
};

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function Credit({ label, dim, children }: { label: string; dim: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2, minWidth: 0 }}>
      <Text variant="label" color={dim}>{label}</Text>
      {children}
    </View>
  );
}

/** Three upcoming songs on a vertical line: Kesar for the context, Neel for what you queued. */
function UpNextTimeline({ onOpenQueue, ink, dim, kesar, neel, surface }: { onOpenQueue: () => void; ink: string; dim: string; kesar: string; neel: string; surface: string }) {
  const userQueue = usePlayerStore((s) => s.userQueue);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const upNext = [
    ...userQueue.map((track) => ({ track, mine: true })),
    ...queue.slice(currentIndex + 1).map((track) => ({ track, mine: false })),
  ].slice(0, 3);

  return (
    <View style={{ backgroundColor: surface, borderRadius: Radius.lg, gap: Space[3], marginHorizontal: Layout.gutter, marginTop: Space[4], padding: Space[5] }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="label" color={ink}>Up next</Text>
        <Pressable onPress={onOpenQueue} hitSlop={10} accessibilityRole="button" accessibilityLabel="Open queue" style={{ justifyContent: 'center', minHeight: Layout.touchTarget }}>
          <Text variant="captionStrong" color={ink}>Open queue</Text>
        </Pressable>
      </View>
      {upNext.length === 0 ? (
        <Text variant="caption" color={dim}>Nothing queued. Autoplay will keep similar music going.</Text>
      ) : (
        upNext.map(({ track, mine }, i) => {
          const nodeColor = mine ? neel : kesar;
          return (
            <Pressable
              key={track.queueId ?? track.id}
              onPress={() => track.queueId && void playback.playQueueItem(track.queueId)}
              style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: Layout.touchTarget }}
              accessibilityRole="button"
              accessibilityLabel={`Play ${track.title}`}
            >
              <View style={{ alignItems: 'center', alignSelf: 'stretch', width: 14 }}>
                <View style={{ backgroundColor: nodeColor, flex: 1, opacity: i === 0 ? 0 : 0.5, width: 2 }} />
                <View style={{ backgroundColor: nodeColor, borderRadius: Radius.pill, height: 10, width: 10 }} />
                <View style={{ backgroundColor: nodeColor, flex: 1, opacity: i === upNext.length - 1 ? 0 : 0.5, width: 2 }} />
              </View>
              <Image source={{ uri: track.thumbnailUrl || track.artwork }} style={{ borderRadius: Radius.xs + 2, height: 40, width: 40 }} contentFit="cover" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="captionStrong" color={ink} numberOfLines={1}>{track.title}</Text>
                <Text variant="caption" color={dim} numberOfLines={1}>{mine ? 'You queued · ' : track.isAutoplay ? 'Autoplay · ' : ''}{track.channelName || track.artist}</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

export default function NowPlayingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const { isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const context = usePlayerStore((s) => s.context);
  const duration = usePlayerStore((s) => s.duration);
  const playingFromUserQueue = usePlayerStore((s) => s.playingFromUserQueue);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const showReconnecting = usePlayerStore((s) => s.showReconnecting);
  const sleepLabel = useSleepTimerLabel();

  const [isQueueVisible, setIsQueueVisible] = useState(false);
  const [isSleepVisible, setIsSleepVisible] = useState(false);
  const [isSpeedVisible, setIsSpeedVisible] = useState(false);
  const [isLyricsVisible, setIsLyricsVisible] = useState(false);
  const deckRef = useRef<DeckArtworkHandle>(null);

  // A right-flick on the deck always means "the song before this one", even
  // mid-song (the button restarts instead; see ArcControls below).
  const previousTrack = async () => {
    if (usePlayerStore.getState().currentPosition > 3) await playback.seek(0);
    await playback.previous();
  };

  const thumbnail = currentTrack ? currentTrack.thumbnail_url || currentTrack.thumbnailUrl || currentTrack.artwork || undefined : undefined;
  const palette = useArtworkColor(thumbnail);
  const youtubeId = currentTrack ? playback.getYoutubeId(currentTrack) : null;
  const isLiked = useIsLiked(youtubeId);
  const lyricsQuery = useLyrics(currentTrack);
  const channelName = currentTrack?.channel_name || currentTrack?.channelName || currentTrack?.artist || '';

  // Artwork-tinted surfaces, per theme.
  const ink = isDark ? '#FFFFFF' : colors.text;
  const dim = isDark ? 'rgba(255,255,255,0.68)' : colors.textSecondary;
  const top = isDark ? palette.background : mix(palette.accent, colors.bg, 0.78);
  const middle = isDark ? palette.muted : mix(palette.accent, colors.bg, 0.92);
  const cardSurface = isDark ? 'rgba(255,255,255,0.07)' : alpha('#0B0F1A', 0.05);
  const lyricsBg = isDark ? mix(palette.accent, '#000000', 0.35) : mix(palette.accent, '#FFFFFF', 0.62);
  const lyricsInk = isDark ? '#FFFFFF' : colors.text;
  // ≥3:1 on the tinted fill: dim lines are large text.
  const lyricsDim = isDark ? 'rgba(255,255,255,0.6)' : alpha('#0B0F1A', 0.56);
  const activeMode = isDark ? colors.accent : colors.accentInk;

  const artSize = Math.min(width - Layout.gutter * 2, height * 0.42, 380);

  // ── Gestures ──
  const translateY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const startedAtTop = useSharedValue(true);
  const scrollGesture = Gesture.Native();

  const dismiss = () => navigation.goBack();
  const dismissGesture = Gesture.Pan()
    .activeOffsetY(15)
    .failOffsetX([-20, 20])
    .simultaneousWithExternalGesture(scrollGesture)
    .onStart(() => {
      startedAtTop.value = scrollY.value <= 0;
    })
    .onUpdate((e) => {
      if (!startedAtTop.value) return;
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (!startedAtTop.value) return;
      if (translateY.value > height * 0.22 || e.velocityY > 1000) {
        translateY.value = withTiming(height * 0.3, { duration: Motion.duration.quick, easing: Motion.easing.in });
        runOnJS(dismiss)();
        return;
      }
      translateY.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out });
    });

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (!currentTrack) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: Space[4] }}>
        <IconButton icon="chevron-down" onPress={dismiss} accessibilityLabel="Close" iconSize={26} />
        <Text variant="body" color="textSecondary" align="center" style={{ marginTop: Space[8] }}>Nothing is playing.</Text>
      </SafeAreaView>
    );
  }

  const song = playback.trackToSong(currentTrack);
  const contextLabel = playingFromUserQueue ? 'Playing from queue' : context ? CONTEXT_LABELS[context.type] : 'Now playing';
  const contextName = playingFromUserQueue ? 'Next in queue' : context?.name ?? '';
  const fromName = playingFromUserQueue ? 'Your queue' : context?.name || 'Your queue';

  return (
    <GestureDetector gesture={dismissGesture}>
      <Animated.View style={[{ flex: 1, backgroundColor: colors.bg }, containerStyle]}>
        <LinearGradient colors={[top, middle, colors.bg]} locations={[0, 0.5, 0.88]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <ReconnectingToast visible={showReconnecting} />

        <View style={{ alignItems: 'center', flexDirection: 'row', paddingBottom: Space[2], paddingHorizontal: Space[2], paddingTop: insets.top + Space[1] }}>
          <IconButton icon="chevron-down" onPress={dismiss} accessibilityLabel="Close player" color={ink} iconSize={26} />
          <View style={{ alignItems: 'center', flex: 1, gap: 2, paddingHorizontal: Space[2] }}>
            <Text variant="label" color={dim} numberOfLines={1}>{contextLabel}</Text>
            {contextName ? <Text variant="captionStrong" color={ink} numberOfLines={1}>{contextName}</Text> : null}
          </View>
          <IconButton icon="ellipsis-horizontal" onPress={() => openSongMenu(song)} accessibilityLabel="More options" color={ink} />
        </View>

        <GestureDetector gesture={scrollGesture}>
          <ScrollView
            onScroll={(e) => {
              scrollY.value = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + Space[10] }}
          >
            <View style={{ justifyContent: 'space-between', minHeight: height - insets.top - 72, paddingBottom: Space[6], paddingHorizontal: Layout.gutter }}>
              <View style={{ flex: 1, justifyContent: 'center', paddingVertical: Space[4] }}>
                <DeckArtwork
                  ref={deckRef}
                  thumbnail={thumbnail}
                  size={artSize}
                  trackKey={currentTrack.queueId ?? currentTrack.id}
                  title={currentTrack.title}
                  lyrics={lyricsQuery.data}
                  lyricsLoading={lyricsQuery.isLoading}
                  lyricsError={lyricsQuery.isError}
                  background={lyricsBg}
                  ink={lyricsInk}
                  dim={lyricsDim}
                  onExpand={() => setIsLyricsVisible(true)}
                  onNext={() => void playback.next()}
                  onPrevious={() => void previousTrack()}
                />
              </View>

              <Rise index={1} style={{ gap: Space[3], marginBottom: Space[3] }}>
                <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: Space[3] }}>
                  <Text variant="display" color={ink} numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>{currentTrack.title}</Text>
                  <LikeButton
                    isLiked={isLiked}
                    size={26}
                    idleColor={dim}
                    onToggle={() => {
                      successHaptic();
                      void setLiked(song, !isLiked);
                    }}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: Space[5] }}>
                  <Pressable
                    onPress={() => channelName && navigation.navigate('Channel', { channelName })}
                    accessibilityRole="link"
                    accessibilityLabel={`Go to ${channelName}`}
                    style={{ flexShrink: 1, minWidth: 0 }}
                  >
                    <Credit label="CHANNEL" dim={dim}>
                      <Text variant="captionStrong" color={ink} numberOfLines={1}>{channelName || 'Unknown'}</Text>
                    </Credit>
                  </Pressable>
                  <Credit label="FROM" dim={dim}>
                    <Text variant="captionStrong" color={ink} numberOfLines={1}>{fromName}</Text>
                  </Credit>
                  <Credit label="LENGTH" dim={dim}>
                    <Text variant="mono" color={ink} tabular>{formatDuration(duration)}</Text>
                  </Credit>
                </View>
              </Rise>

              <Rise index={2}>
                <MeendSeek
                  fill={colors.accent}
                  track={isDark ? 'rgba(255,255,255,0.2)' : alpha('#0B0F1A', 0.12)}
                  thumb={ink}
                  textColor={dim}
                  bubbleText={isDark ? '#0B0F1A' : '#FFFFFF'}
                />
              </Rise>

              <Rise index={3} style={{ marginTop: Space[3] }}>
                <ArcControls
                  ink={ink}
                  dim={dim}
                  activeColor={activeMode}
                  onNext={() => deckRef.current?.flick('next')}
                  onPrevious={() => {
                    // Past 3s, "previous" restarts the song in place — no card leaves.
                    if (usePlayerStore.getState().currentPosition > 3) void playback.previous();
                    else deckRef.current?.flick('previous');
                  }}
                />
              </Rise>

              <Rise index={4} style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: Space[4] }}>
                <Pressable onPress={() => setIsSleepVisible(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={sleepLabel ? `Sleep timer, ${sleepLabel}` : 'Sleep timer'}
                  style={{ alignItems: 'center', flexDirection: 'row', gap: Space[1], height: Layout.touchTarget, minWidth: Layout.touchTarget }}>
                  <Ionicons name={sleepLabel ? 'moon' : 'moon-outline'} size={20} color={sleepLabel ? activeMode : dim} />
                  {sleepLabel ? <Text variant="mono" color={activeMode} tabular>{sleepLabel}</Text> : null}
                </Pressable>
                <Pressable onPress={() => setIsSpeedVisible(true)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Playback speed ${speedLabel(playbackRate)}`}
                  style={{ alignItems: 'center', height: Layout.touchTarget, justifyContent: 'center', minWidth: Layout.touchTarget }}>
                  <Text variant="mono" color={playbackRate !== 1 ? activeMode : dim}>{speedLabel(playbackRate)}</Text>
                </Pressable>
                <IconButton icon="add-circle-outline" onPress={() => openSaveSheet(song)} accessibilityLabel="Save to playlist" color={dim} />
                <IconButton icon="share-outline" onPress={() => void shareSong(song)} accessibilityLabel="Share" color={dim} iconSize={21} />
                <IconButton icon="list" onPress={() => setIsQueueVisible(true)} accessibilityLabel="Open queue" color={dim} />
              </Rise>
            </View>

            <LyricsCard
              lyrics={lyricsQuery.data}
              isLoading={lyricsQuery.isLoading}
              isError={lyricsQuery.isError}
              background={lyricsBg}
              ink={lyricsInk}
              dim={lyricsDim}
              marker={colors.accent}
              onExpand={() => setIsLyricsVisible(true)}
            />

            <UpNextTimeline onOpenQueue={() => setIsQueueVisible(true)} ink={ink} dim={dim} kesar={colors.accent} neel={colors.signal} surface={cardSurface} />

            <View style={{ backgroundColor: cardSurface, borderRadius: Radius.lg, gap: Space[4], marginHorizontal: Layout.gutter, marginTop: Space[4], padding: Space[5] }}>
              <Text variant="label" color={ink}>About the channel</Text>
              <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3] }}>
                <View style={{ alignItems: 'center', backgroundColor: palette.accent, borderRadius: Radius.pill, height: 52, justifyContent: 'center', width: 52 }}>
                  <Text variant="headline" color="#FFFFFF">{channelName.charAt(0).toUpperCase() || '♪'}</Text>
                </View>
                <Text variant="title" color={ink} numberOfLines={2} style={{ flex: 1 }}>{channelName}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: Space[2] }}>
                <Button label="Go to channel" size="sm" variant="secondary" onPress={() => navigation.navigate('Channel', { channelName })} />
                <Button label="Song radio" icon="radio-outline" size="sm" variant="secondary" onPress={() => void playback.startRadio(song).catch(() => {})} />
              </View>
            </View>
          </ScrollView>
        </GestureDetector>

        <QueueSheet isVisible={isQueueVisible} onClose={() => setIsQueueVisible(false)} />
        <SleepTimer isVisible={isSleepVisible} onClose={() => setIsSleepVisible(false)} />
        <SpeedSheet isVisible={isSpeedVisible} onClose={() => setIsSpeedVisible(false)} />
        <LyricsView
          visible={isLyricsVisible}
          onClose={() => setIsLyricsVisible(false)}
          lyrics={lyricsQuery.data}
          background={top}
          base={colors.bg}
          ink={ink}
          dim={isDark ? 'rgba(255,255,255,0.4)' : alpha('#0B0F1A', 0.38)}
          title={currentTrack.title}
          artist={channelName}
        />
      </Animated.View>
    </GestureDetector>
  );
}
