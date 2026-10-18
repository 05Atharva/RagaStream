import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Slider from '@react-native-community/slider';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
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
import { LyricsCard, LyricsView } from '../components/Lyrics';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore, type PlaybackContext, type Track } from '../store/playerStore';
import { openSaveSheet, openSongMenu } from '../store/songMenuStore';
import * as playback from '../services/playbackController';
import { setLiked, shareSong } from '../services/libraryActions';
import { gestureHaptic, successHaptic, tapHaptic } from '../services/haptics';
import { useArtworkColor } from '../hooks/useArtworkColor';
import { useIsLiked } from '../hooks/useLiked';
import { useLyrics } from '../hooks/useLyrics';
import { Colors, Motion, TypeScale } from '../constants/theme';

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

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Long titles scroll horizontally; short ones sit still. */
function MarqueeText({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(translateX);
    translateX.value = 0;
    if (!containerWidth || !textWidth || textWidth <= containerWidth) return;
    const delta = textWidth - containerWidth + 24;
    translateX.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 2000 }),
        withTiming(-delta, { duration: Math.max(3500, delta * 25), easing: Easing.linear }),
        withTiming(-delta, { duration: 1200 }),
        withTiming(0, { duration: 0 })
      ),
      -1,
      false
    );
  }, [containerWidth, textWidth, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  return (
    <View onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)} style={styles.marqueeMask}>
      <Animated.Text
        numberOfLines={1}
        onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
        style={[style, styles.marqueeText, animatedStyle]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

/** Seek bar: purple fill, thumb grows and a time tooltip appears while dragging. */
function SeekBar() {
  const position = usePlayerStore((s) => s.currentPosition);
  const duration = usePlayerStore((s) => s.duration);
  const [width, setWidth] = useState(0);
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const thumbScale = useSharedValue(1);
  const tooltipOpacity = useSharedValue(0);

  const shown = seekValue ?? position;
  const max = Math.max(duration, 1);
  const thumbX = width > 0 ? (Math.min(shown, max) / max) * width : 0;
  const tooltipLeft = Math.max(0, Math.min(thumbX - 24, Math.max(0, width - 48)));

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ scale: thumbScale.value }] }));
  const tooltipStyle = useAnimatedStyle(() => ({ opacity: tooltipOpacity.value }));

  return (
    <View style={styles.seekSection}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.seekSliderWrapper}>
        <Animated.View pointerEvents="none" style={[styles.seekTooltip, tooltipStyle, { left: tooltipLeft }]}>
          <Text style={styles.seekTooltipText}>{formatTime(shown)}</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.seekThumb, thumbStyle, { left: thumbX - 6 }]} />
        <Slider
          value={position}
          minimumValue={0}
          maximumValue={max}
          minimumTrackTintColor="#FFFFFF"
          maximumTrackTintColor="rgba(255,255,255,0.25)"
          thumbTintColor="transparent"
          onSlidingStart={(value) => {
            setSeekValue(value);
            thumbScale.value = withTiming(1.5, { duration: Motion.duration.fast });
            tooltipOpacity.value = withTiming(1, { duration: Motion.duration.fast });
          }}
          onValueChange={(value) => setSeekValue(value)}
          onSlidingComplete={(value) => {
            thumbScale.value = withTiming(1, { duration: Motion.duration.quick });
            tooltipOpacity.value = withTiming(0, { duration: Motion.duration.quick });
            void playback.seek(value).finally(() => setSeekValue(null));
          }}
        />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatTime(shown)}</Text>
        <Text style={styles.timeText}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}

function UpNextCard({ onOpenQueue }: { onOpenQueue: () => void }) {
  const userQueue = usePlayerStore((s) => s.userQueue);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const upNext: Track[] = [...userQueue, ...queue.slice(currentIndex + 1)].slice(0, 3);

  return (
    <View style={styles.infoCard}>
      <View style={styles.infoCardHeader}>
        <Text style={styles.infoCardTitle}>Up next</Text>
        <Pressable onPress={onOpenQueue} hitSlop={8} style={styles.pillButton}>
          <Text style={styles.pillButtonText}>Open queue</Text>
        </Pressable>
      </View>
      {upNext.length === 0 ? (
        <Text style={styles.infoCardEmpty}>Your queue is empty.</Text>
      ) : (
        upNext.map((track) => (
          <Pressable
            key={track.queueId ?? track.id}
            onPress={() => track.queueId && void playback.playQueueItem(track.queueId)}
            style={styles.upNextRow}
          >
            <Image
              source={{ uri: track.thumbnailUrl || track.artwork }}
              style={styles.upNextThumb}
              contentFit="cover"
            />
            <View style={styles.upNextMeta}>
              <Text numberOfLines={1} style={styles.upNextTitle}>{track.title}</Text>
              <Text numberOfLines={1} style={styles.upNextSubtitle}>
                {track.isAutoplay ? 'Autoplay · ' : ''}
                {track.channelName || track.artist}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

export default function NowPlayingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
  const [isSleepTimerVisible, setIsSleepTimerVisible] = useState(false);
  const [isSpeedVisible, setIsSpeedVisible] = useState(false);
  const [isLyricsVisible, setIsLyricsVisible] = useState(false);

  const thumbnailSource = currentTrack
    ? currentTrack.thumbnail_url || currentTrack.thumbnailUrl || currentTrack.artwork || undefined
    : undefined;
  const palette = useArtworkColor(thumbnailSource);
  const youtubeId = currentTrack ? playback.getYoutubeId(currentTrack) : null;
  const isLiked = useIsLiked(youtubeId);
  const lyricsQuery = useLyrics(currentTrack);
  const channelName = currentTrack?.channel_name || currentTrack?.channelName || currentTrack?.artist || '';

  const albumSize = Math.min(width - 48, height * 0.42, 360);

  // ── Gestures: swipe down to dismiss (only from the top of the page), swipe
  //    the artwork sideways to skip. ──
  const translateY = useSharedValue(0);
  const artX = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const startedAtTop = useSharedValue(true);
  const scrollGesture = Gesture.Native();

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
    .onUpdate((event) => {
      if (!startedAtTop.value) return;
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (!startedAtTop.value) return;
      if (translateY.value > height * 0.25 || event.velocityY > 1000) {
        translateY.value = withTiming(height * 0.3, { duration: Motion.duration.quick });
        runOnJS(dismiss)();
        return;
      }
      translateY.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.standard });
    });

  const skipGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onUpdate((event) => {
      artX.value = event.translationX;
    })
    .onEnd((event) => {
      const commit = Math.abs(event.translationX) > width * SWIPE_SKIP_RATIO || Math.abs(event.velocityX) > 800;
      if (commit) {
        const exitX = event.translationX < 0 ? -width : width;
        artX.value = withSequence(
          withTiming(exitX, { duration: Motion.duration.quick, easing: Motion.easing.accelerate }),
          withTiming(-exitX * 0.5, { duration: 0 }),
          withTiming(0, { duration: Motion.duration.enter, easing: Motion.easing.decelerate })
        );
        runOnJS(skip)(event.translationX < 0 ? 'next' : 'previous');
      } else {
        artX.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.standard });
      }
    });

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const artStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: artX.value }],
    opacity: 1 - Math.min(Math.abs(artX.value) / width, 0.5),
  }));

  if (!currentTrack) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <Pressable hitSlop={8} onPress={dismiss} style={styles.headerBtn}>
          <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.emptyText}>Nothing is playing.</Text>
      </SafeAreaView>
    );
  }

  const song = playback.trackToSong(currentTrack);
  const contextLabel = playingFromUserQueue ? 'Playing from queue' : context ? CONTEXT_LABELS[context.type] : 'Now playing';
  const contextName = playingFromUserQueue ? 'Next in queue' : context?.name ?? '';

  const handleToggleLike = () => {
    successHaptic();
    void setLiked(song, !isLiked);
  };

  return (
    <GestureDetector gesture={dismissGesture}>
      <Animated.View style={[styles.flex, containerStyle]}>
        {/* Artwork-tinted gradient — crossfades when the track changes */}
        <Animated.View
          key={palette.background}
          entering={FadeIn.duration(Motion.duration.slow)}
          exiting={FadeOut.duration(Motion.duration.slow)}
          style={StyleSheet.absoluteFillObject}
        >
          <LinearGradient
            colors={[palette.background, palette.muted, '#000000']}
            locations={[0, 0.45, 0.85]}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>

        <ReconnectingToast visible={showReconnecting} />

        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
          <Pressable hitSlop={8} onPress={dismiss} style={styles.headerBtn} accessibilityLabel="Close">
            <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text numberOfLines={1} style={styles.headerLabel}>{contextLabel}</Text>
            {contextName ? <Text numberOfLines={1} style={styles.headerContext}>{contextName}</Text> : null}
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => openSongMenu(song)}
            style={styles.headerBtn}
            accessibilityLabel="More options"
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        <GestureDetector gesture={scrollGesture}>
        <ScrollView
          onScroll={(e) => {
            scrollY.value = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        >
          {/* ── Player ── */}
          <View style={[styles.player, { minHeight: height - insets.top - 64 }]}>
            <GestureDetector gesture={skipGesture}>
              <Animated.View style={[styles.artSection, artStyle]}>
                <Image
                  source={thumbnailSource ? { uri: thumbnailSource } : undefined}
                  style={[styles.artwork, { width: albumSize, height: albumSize }]}
                  contentFit="cover"
                  transition={Motion.duration.base}
                />
              </Animated.View>
            </GestureDetector>

            <View style={styles.metaRow}>
              <View style={styles.metaText}>
                <MarqueeText text={currentTrack.title} style={styles.title} />
                <Pressable onPress={() => channelName && navigation.navigate('Channel', { channelName })}>
                  <Text numberOfLines={1} style={styles.channelName}>{channelName}</Text>
                </Pressable>
              </View>
              <LikeButton isLiked={isLiked} onToggle={handleToggleLike} size={26} />
            </View>

            <SeekBar />

            <View style={styles.controlsRow}>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  tapHaptic();
                  void playback.cycleShuffle();
                }}
                style={styles.modeButton}
                accessibilityLabel={`Shuffle: ${shuffleMode}`}
              >
                <Ionicons name="shuffle" size={26} color={shuffleMode === 'off' ? Colors.textSubdued : Colors.secondary} />
                {shuffleMode === 'smart' ? (
                  <Ionicons name="sparkles" size={11} color={Colors.secondary} style={styles.modeBadgeIcon} />
                ) : null}
                <View style={[styles.modeDot, shuffleMode !== 'off' && styles.modeDotActive]} />
              </Pressable>

              <Pressable hitSlop={8} onPress={() => skip('previous')} style={styles.transportButton} accessibilityLabel="Previous">
                <Ionicons name="play-skip-back" size={32} color="#FFFFFF" />
              </Pressable>

              <Pressable
                onPress={() => {
                  tapHaptic();
                  void playback.togglePlay();
                }}
                style={({ pressed }) => [styles.playPauseButton, pressed && { transform: [{ scale: Motion.pressScale }] }]}
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              >
                {isLoading && !isPlaying ? (
                  <ActivityIndicator color="#000000" />
                ) : (
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={34}
                    color="#000000"
                    style={!isPlaying ? styles.playIconOffset : undefined}
                  />
                )}
              </Pressable>

              <Pressable hitSlop={8} onPress={() => skip('next')} style={styles.transportButton} accessibilityLabel="Next">
                <Ionicons name="play-skip-forward" size={32} color="#FFFFFF" />
              </Pressable>

              <Pressable
                hitSlop={8}
                onPress={() => {
                  tapHaptic();
                  playback.cycleRepeat();
                }}
                style={styles.modeButton}
                accessibilityLabel={`Repeat: ${repeatMode}`}
              >
                <Ionicons name="repeat" size={26} color={repeatMode === 'off' ? Colors.textSubdued : Colors.secondary} />
                {repeatMode === 'one' ? <Text style={styles.repeatOneBadge}>1</Text> : null}
                <View style={[styles.modeDot, repeatMode !== 'off' && styles.modeDotActive]} />
              </Pressable>
            </View>

            <View style={styles.actionsRow}>
              <Pressable onPress={() => setIsSleepTimerVisible(true)} style={styles.actionButton} hitSlop={6}>
                <Ionicons name={sleepLabel ? 'moon' : 'moon-outline'} size={20} color={sleepLabel ? Colors.secondary : Colors.textSubdued} />
                {sleepLabel ? <Text style={styles.actionLabelActive}>{sleepLabel}</Text> : null}
              </Pressable>
              <Pressable onPress={() => setIsSpeedVisible(true)} style={styles.actionButton} hitSlop={6}>
                <Text style={[styles.speedText, playbackRate !== 1 && styles.actionLabelActive]}>
                  {speedLabel(playbackRate)}
                </Text>
              </Pressable>
              <Pressable onPress={() => openSaveSheet(song)} style={styles.actionButton} hitSlop={6} accessibilityLabel="Save to playlist">
                <Ionicons name="add-circle-outline" size={22} color={Colors.textSubdued} />
              </Pressable>
              <Pressable onPress={() => void shareSong(song)} style={styles.actionButton} hitSlop={6} accessibilityLabel="Share">
                <Ionicons name="share-social-outline" size={20} color={Colors.textSubdued} />
              </Pressable>
              <Pressable onPress={() => setIsQueueVisible(true)} style={styles.actionButton} hitSlop={6} accessibilityLabel="Queue">
                <Ionicons name="list" size={22} color={Colors.textSubdued} />
              </Pressable>
            </View>
          </View>

          {/* ── Below the fold: lyrics, up next, about the channel ── */}
          <LyricsCard
            lyrics={lyricsQuery.data}
            isLoading={lyricsQuery.isLoading}
            isError={lyricsQuery.isError}
            accent={palette.accent}
            onExpand={() => setIsLyricsVisible(true)}
          />

          <UpNextCard onOpenQueue={() => setIsQueueVisible(true)} />

          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>About the channel</Text>
            <View style={styles.channelRow}>
              <View style={[styles.channelAvatar, { backgroundColor: palette.accent }]}>
                <Text style={styles.channelAvatarText}>{channelName.charAt(0).toUpperCase() || '♪'}</Text>
              </View>
              <Text numberOfLines={2} style={styles.channelCardName}>{channelName}</Text>
            </View>
            <View style={styles.channelActions}>
              <Pressable
                onPress={() => navigation.navigate('Channel', { channelName })}
                style={styles.pillButton}
              >
                <Text style={styles.pillButtonText}>Go to channel</Text>
              </Pressable>
              <Pressable
                onPress={() => void playback.startRadio(song).catch(() => {})}
                style={styles.pillButton}
              >
                <Ionicons name="radio-outline" size={14} color="#FFFFFF" />
                <Text style={styles.pillButtonText}>Song radio</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
        </GestureDetector>

        <QueueSheet isVisible={isQueueVisible} onClose={() => setIsQueueVisible(false)} />
        <SleepTimer isVisible={isSleepTimerVisible} onClose={() => setIsSleepTimerVisible(false)} />
        <SpeedSheet isVisible={isSpeedVisible} onClose={() => setIsSpeedVisible(false)} />
        <LyricsView
          visible={isLyricsVisible}
          onClose={() => setIsLyricsVisible(false)}
          lyrics={lyricsQuery.data}
          background={palette.background}
          title={currentTrack.title}
          artist={channelName}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  flex: {
    backgroundColor: '#000000',
    flex: 1,
  },
  emptyState: {
    backgroundColor: '#000000',
    flex: 1,
    padding: 16,
  },
  emptyText: {
    color: Colors.textSubdued,
    fontSize: TypeScale.body,
    marginTop: 32,
    textAlign: 'center',
  },

  // ── Header ──
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  headerBtn: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 8,
  },
  headerLabel: {
    color: Colors.textSubdued,
    fontSize: TypeScale.caption,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  headerContext: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '700',
    marginTop: 2,
  },

  // ── Player ──
  player: {
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 24,
  },
  artSection: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  artwork: {
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  metaText: {
    flex: 1,
    minWidth: 0,
  },
  marqueeMask: {
    overflow: 'hidden',
  },
  marqueeText: {
    alignSelf: 'flex-start',
  },
  title: {
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
  },
  channelName: {
    color: Colors.textSubdued,
    fontSize: TypeScale.body,
    marginTop: 2,
  },

  // ── Seek ──
  seekSection: {
    marginBottom: 8,
  },
  seekSliderWrapper: {
    justifyContent: 'center',
    marginHorizontal: -8,
  },
  seekThumb: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    height: 12,
    marginLeft: 8,
    position: 'absolute',
    width: 12,
  },
  seekTooltip: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    top: -30,
    width: 48,
  },
  seekTooltipText: {
    color: '#FFFFFF',
    fontSize: TypeScale.caption,
    fontWeight: '600',
    textAlign: 'center',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: Colors.textSubdued,
    fontSize: TypeScale.caption,
  },

  // ── Transport ──
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  modeBadgeIcon: {
    position: 'absolute',
    right: 4,
    top: 4,
  },
  repeatOneBadge: {
    color: Colors.secondary,
    fontSize: 9,
    fontWeight: '800',
    position: 'absolute',
    top: 16,
  },
  modeDot: {
    borderRadius: 2,
    bottom: 2,
    height: 4,
    position: 'absolute',
    width: 4,
  },
  modeDotActive: {
    backgroundColor: Colors.secondary,
  },
  transportButton: {
    alignItems: 'center',
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  playPauseButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  playIconOffset: {
    marginLeft: 4,
  },
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    height: 40,
    justifyContent: 'center',
    minWidth: 40,
  },
  actionLabelActive: {
    color: Colors.secondary,
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  speedText: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    fontWeight: '700',
  },

  // ── Cards below the player ──
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
  },
  infoCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  infoCardTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
    fontWeight: '700',
  },
  infoCardEmpty: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
  },
  pillButton: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  pillButtonText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  upNextRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
  },
  upNextThumb: {
    borderRadius: 8,
    height: 40,
    width: 40,
  },
  upNextMeta: {
    flex: 1,
    minWidth: 0,
  },
  upNextTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  upNextSubtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
  },
  channelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginVertical: 12,
  },
  channelAvatar: {
    alignItems: 'center',
    borderRadius: 999,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  channelAvatarText: {
    color: '#FFFFFF',
    fontSize: TypeScale.heading,
    fontWeight: '700',
  },
  channelCardName: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: TypeScale.large,
    fontWeight: '700',
  },
  channelActions: {
    flexDirection: 'row',
    gap: 8,
  },
});
