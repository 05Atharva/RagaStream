import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View, type StyleProp, type TextStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import LikeButton from '../components/LikeButton';
import SleepTimer, { useSleepTimerLabel } from '../components/SleepTimer';
import SpeedSheet, { speedLabel } from '../components/SpeedSheet';
import QueueSheet from '../components/QueueSheet';
import ReconnectingToast from '../components/ReconnectingToast';
import SeekBar from '../components/SeekBar';
import { LyricsCard, LyricsView } from '../components/Lyrics';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import PlayPauseIcon from '../motion/PlayPauseIcon';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore, type PlaybackContext, type Track } from '../store/playerStore';
import { openSaveSheet, openSongMenu } from '../store/songMenuStore';
import * as playback from '../services/playbackController';
import { setLiked, shareSong } from '../services/libraryActions';
import { gestureHaptic, successHaptic, tapHaptic } from '../services/haptics';
import { useArtworkColor } from '../hooks/useArtworkColor';
import { useIsLiked } from '../hooks/useLiked';
import { useLyrics } from '../hooks/useLyrics';
import { Elevation, Layout, Motion, Radius, Space, Type, alpha, mix } from '../constants/theme';
import { useColors, useTheme } from '../theme/ThemeProvider';

const SWIPE_SKIP_RATIO = 0.22;

const CONTEXT_LABELS: Record<PlaybackContext['type'], string> = {
  playlist: 'Playing from playlist',
  liked: 'Playing from your library',
  search: 'Playing from search',
  channel: 'Playing from channel',
  home: 'Playing from Home',
  radio: 'Playing from radio',
  queue: 'Playing from queue',
};

/** Long titles drift sideways after a pause; short ones sit still. */
function MarqueeText({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    cancelAnimation(translateX);
    translateX.value = 0;
    if (reduced || !containerWidth || !textWidth || textWidth <= containerWidth) return;
    const delta = textWidth - containerWidth + 24;
    translateX.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 2400 }),
        withTiming(-delta, { duration: Math.max(3500, delta * 28), easing: Easing.inOut(Easing.quad) }),
        withTiming(-delta, { duration: 1400 }),
        withTiming(0, { duration: 600, easing: Motion.easing.glide })
      ),
      -1,
      false
    );
  }, [containerWidth, reduced, textWidth, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  return (
    <View onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)} style={{ overflow: 'hidden' }}>
      <Animated.Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
        style={[style, { alignSelf: 'flex-start' }, animatedStyle]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

function ModeButton({
  icon,
  active,
  badge,
  onPress,
  label,
  ink,
  activeColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  badge?: React.ReactNode;
  onPress: () => void;
  label: string;
  /** Colour when inactive. */
  ink: string;
  activeColor: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }}
      style={{ alignItems: 'center', height: Layout.touchTarget + 4, justifyContent: 'center', width: Layout.touchTarget }}>
      <Ionicons name={icon} size={24} color={active ? activeColor : ink} />
      {badge}
      <View style={{ position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: 2, backgroundColor: active ? activeColor : 'transparent' }} />
    </Pressable>
  );
}

function UpNextCard({ onOpenQueue, ink, dim, surface }: { onOpenQueue: () => void; ink: string; dim: string; surface: string }) {
  const userQueue = usePlayerStore((s) => s.userQueue);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const upNext: Track[] = [...userQueue, ...queue.slice(currentIndex + 1)].slice(0, 3);

  return (
    <View style={{ backgroundColor: surface, borderRadius: Radius.lg, gap: Space[3], marginHorizontal: Layout.gutter, marginTop: Space[4], padding: Space[5] }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="label" color={ink}>Up next</Text>
        <Pressable onPress={onOpenQueue} hitSlop={10} accessibilityRole="button">
          <Text variant="captionStrong" color={ink}>Open queue</Text>
        </Pressable>
      </View>
      {upNext.length === 0 ? (
        <Text variant="caption" color={dim}>Nothing queued. Autoplay will keep similar music going.</Text>
      ) : (
        upNext.map((track) => (
          <Pressable key={track.queueId ?? track.id} onPress={() => track.queueId && void playback.playQueueItem(track.queueId)}
            style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3] }} accessibilityRole="button" accessibilityLabel={`Play ${track.title}`}>
            <Image source={{ uri: track.thumbnailUrl || track.artwork }} style={{ borderRadius: Radius.xs + 2, height: 40, width: 40 }} contentFit="cover" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="captionStrong" color={ink} numberOfLines={1}>{track.title}</Text>
              <Text variant="caption" color={dim} numberOfLines={1}>{track.isAutoplay ? 'Autoplay · ' : ''}{track.channelName || track.artist}</Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

export default function NowPlayingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const context = usePlayerStore((s) => s.context);
  const playingFromUserQueue = usePlayerStore((s) => s.playingFromUserQueue);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const showReconnecting = usePlayerStore((s) => s.showReconnecting);
  const sleepLabel = useSleepTimerLabel();

  const [isQueueVisible, setIsQueueVisible] = useState(false);
  const [isSleepVisible, setIsSleepVisible] = useState(false);
  const [isSpeedVisible, setIsSpeedVisible] = useState(false);
  const [isLyricsVisible, setIsLyricsVisible] = useState(false);

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
  const lyricsDim = isDark ? 'rgba(255,255,255,0.45)' : alpha('#0B0F1A', 0.42);
  const activeMode = isDark ? colors.accent : colors.accentInk;

  const artSize = Math.min(width - Layout.gutter * 2, height * 0.42, 380);

  // ── Gestures ──
  const translateY = useSharedValue(0);
  const artX = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const startedAtTop = useSharedValue(true);
  const scrollGesture = Gesture.Native();

  // Entrance + breath: art settles in on open, eases back when paused.
  const artScale = useSharedValue(reduced ? 1 : 0.9);
  useEffect(() => {
    artScale.value = withTiming(isPlaying || reduced ? 1 : 0.93, {
      duration: isPlaying ? Motion.duration.slow : Motion.duration.glide,
      easing: Motion.easing.glide,
    });
  }, [artScale, isPlaying, reduced]);

  const dismiss = () => navigation.goBack();
  const skip = (direction: 'next' | 'previous') => {
    gestureHaptic();
    void (direction === 'next' ? playback.next() : playback.previous());
  };

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

  const skipGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      artX.value = e.translationX;
    })
    .onEnd((e) => {
      const commit = Math.abs(e.translationX) > width * SWIPE_SKIP_RATIO || Math.abs(e.velocityX) > 800;
      if (!commit) {
        artX.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out });
        return;
      }
      const exit = e.translationX < 0 ? -width : width;
      artX.value = withSequence(
        withTiming(exit, { duration: Motion.duration.quick, easing: Motion.easing.in }),
        withTiming(-exit * 0.5, { duration: 0 }),
        withTiming(0, { duration: Motion.duration.glide, easing: Motion.easing.out })
      );
      runOnJS(skip)(e.translationX < 0 ? 'next' : 'previous');
    });

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const artStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(Math.abs(artX.value) / width, 0.5),
    transform: [{ translateX: artX.value }, { rotate: `${(artX.value / width) * 6}deg` }, { scale: artScale.value }],
  }));

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
              <GestureDetector gesture={skipGesture}>
                <Animated.View style={[{ alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: Space[4] }, artStyle]}>
                  <View style={[{ borderRadius: Radius.lg }, Elevation.art]}>
                    <Image
                      source={thumbnail ? { uri: thumbnail } : undefined}
                      style={{ borderRadius: Radius.lg, height: artSize, width: artSize }}
                      contentFit="cover"
                      transition={Motion.duration.glide}
                      accessibilityLabel={`Artwork for ${currentTrack.title}. Swipe to skip.`}
                    />
                  </View>
                </Animated.View>
              </GestureDetector>

              <Rise index={1} style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], marginBottom: Space[3] }}>
                <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                  <MarqueeText text={currentTrack.title} style={[Type.headline, { color: ink }]} />
                  <Pressable onPress={() => channelName && navigation.navigate('Channel', { channelName })} accessibilityRole="link" accessibilityLabel={`Go to ${channelName}`}>
                    <Text variant="body" color={dim} numberOfLines={1}>{channelName}</Text>
                  </Pressable>
                </View>
                <LikeButton
                  isLiked={isLiked}
                  size={26}
                  idleColor={dim}
                  onToggle={() => {
                    successHaptic();
                    void setLiked(song, !isLiked);
                  }}
                />
              </Rise>

              <Rise index={2}>
                <SeekBar
                  fill={colors.accent}
                  track={isDark ? 'rgba(255,255,255,0.2)' : alpha('#0B0F1A', 0.12)}
                  thumb={ink}
                  textColor={dim}
                  bubbleText={isDark ? '#0B0F1A' : '#FFFFFF'}
                />
              </Rise>

              <Rise index={3} style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: Space[3] }}>
                <ModeButton
                  icon="shuffle"
                  active={shuffleMode !== 'off'}
                  label={shuffleMode === 'smart' ? 'Smart Shuffle on' : shuffleMode === 'shuffle' ? 'Shuffle on' : 'Shuffle off'}
                  onPress={() => {
                    tapHaptic();
                    void playback.cycleShuffle();
                  }}
                  ink={dim}
                  activeColor={activeMode}
                  badge={shuffleMode === 'smart' ? <Ionicons name="sparkles" size={11} color={activeMode} style={{ position: 'absolute', right: 4, top: 6 }} /> : null}
                />
                <IconButton icon="play-skip-back" onPress={() => skip('previous')} accessibilityLabel="Previous" color={ink} iconSize={30} size={52} />
                <Pressable
                  onPress={() => {
                    tapHaptic();
                    void playback.togglePlay();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                  style={({ pressed }) => [
                    { alignItems: 'center', backgroundColor: colors.accent, borderRadius: Radius.pill, height: 72, justifyContent: 'center', width: 72 },
                    Elevation.floating,
                    pressed && { transform: [{ scale: 0.94 }] },
                  ]}
                >
                  {isLoading && !isPlaying ? <ActivityIndicator color={colors.onAccent} /> : <PlayPauseIcon playing={isPlaying} size={32} color={colors.onAccent} />}
                </Pressable>
                <IconButton icon="play-skip-forward" onPress={() => skip('next')} accessibilityLabel="Next" color={ink} iconSize={30} size={52} />
                <ModeButton
                  icon="repeat"
                  active={repeatMode !== 'off'}
                  label={repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off'}
                  onPress={() => {
                    tapHaptic();
                    playback.cycleRepeat();
                  }}
                  ink={dim}
                  activeColor={activeMode}
                  badge={repeatMode === 'one' ? <Text variant="label" color={activeMode} style={{ position: 'absolute', top: 15, fontSize: 9 }}>1</Text> : null}
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
              onExpand={() => setIsLyricsVisible(true)}
            />

            <UpNextCard onOpenQueue={() => setIsQueueVisible(true)} ink={ink} dim={dim} surface={cardSurface} />

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
