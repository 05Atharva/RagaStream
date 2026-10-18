import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { setLiked } from '../services/libraryActions';
import { gestureHaptic, successHaptic, tapHaptic } from '../services/haptics';
import { useArtworkColor } from '../hooks/useArtworkColor';
import { useIsLiked } from '../hooks/useLiked';
import { Layout, Motion, Radius, Space, mix } from '../constants/theme';
import { makeStyles, useColors, useTheme } from '../theme/ThemeProvider';
import { setFlightTarget, useFlightArrivals } from '../motion/flight';
import PlayPauseIcon from '../motion/PlayPauseIcon';
import LikeButton from './LikeButton';
import Text from './ui/Text';

type MiniPlayerProps = {
  onOpenNowPlaying: () => void;
};

export const MINI_PLAYER_HEIGHT = Layout.miniPlayerHeight;
const SWIPE_COMMIT_RATIO = 0.25;

function ProgressLine({ color, track }: { color: string; track: string }) {
  const position = usePlayerStore((s) => s.currentPosition);
  const duration = usePlayerStore((s) => s.duration);
  const ratio = duration > 0 ? Math.min(position / duration, 1) : 0;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: Space[3], right: Space[3], bottom: 0, height: 2, backgroundColor: track, borderRadius: 2 }}>
      <View style={{ width: `${ratio * 100}%`, height: 2, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

/**
 * The mini player floats above the tab bar, tinted with the current
 * artwork's colour. It rises on the first track, crossfades its tint between
 * songs, skips on a horizontal swipe, and catches queued songs (glide flights)
 * with a small bump.
 */
export default function MiniPlayer({ onOpenNowPlaying }: MiniPlayerProps) {
  const styles = useStyles();
  const colors = useColors();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const arrivals = useFlightArrivals();

  const thumbnail = currentTrack ? currentTrack.thumbnail_url || currentTrack.thumbnailUrl || currentTrack.artwork : null;
  const palette = useArtworkColor(thumbnail);
  const youtubeId = currentTrack ? playback.getYoutubeId(currentTrack) : null;
  const isLiked = useIsLiked(youtubeId);

  // Dark: deep artwork tint with light text. Light: pale artwork wash with ink text.
  const tint = isDark ? palette.background : mix(palette.accent, '#FFFFFF', 0.84);
  const fg = isDark ? '#FFFFFF' : colors.text;
  const fgSub = isDark ? 'rgba(255,255,255,0.7)' : colors.textSecondary;

  const enter = useSharedValue(reduced ? 0 : Layout.miniPlayerHeight + 24);
  const bump = useSharedValue(1);
  const swipeX = useSharedValue(0);
  const tintSv = useSharedValue<string>(tint);
  const thumbRef = useRef<View>(null);
  const entered = useRef(false);

  useEffect(() => {
    if (!currentTrack || entered.current) return;
    entered.current = true;
    enter.value = withTiming(0, { duration: Motion.duration.slow, easing: Motion.easing.out });
  }, [currentTrack, enter]);

  useEffect(() => {
    tintSv.value = withTiming(tint, { duration: Motion.duration.slow, easing: Motion.easing.standard });
  }, [tint, tintSv]);

  // A queued song just landed: lean in to catch it, then settle.
  useEffect(() => {
    if (arrivals === 0 || reduced) return;
    bump.value = withSequence(
      withTiming(1.04, { duration: 110, easing: Motion.easing.out }),
      withTiming(1, { duration: 220, easing: Motion.easing.standard })
    );
  }, [arrivals, bump, reduced]);

  useEffect(() => {
    setFlightTarget((done) =>
      thumbRef.current?.measureInWindow((x, y, w, h) => done({ x: x + w / 2, y: y + h / 2 }))
    );
    return () => setFlightTarget(null);
  }, []);

  const skip = (direction: 'next' | 'previous') => {
    gestureHaptic();
    void (direction === 'next' ? playback.next() : playback.previous());
  };

  const swipe = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      swipeX.value = e.translationX;
    })
    .onEnd((e) => {
      const commit = Math.abs(e.translationX) > width * SWIPE_COMMIT_RATIO || Math.abs(e.velocityX) > 800;
      if (!commit) {
        swipeX.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out });
        return;
      }
      const exit = e.translationX < 0 ? -width * 0.6 : width * 0.6;
      // Leave on `in`, re-enter from the opposite side on `out`: the new song arrives.
      swipeX.value = withSequence(
        withTiming(exit, { duration: Motion.duration.quick, easing: Motion.easing.in }),
        withTiming(-exit * 0.5, { duration: 0 }),
        withTiming(0, { duration: Motion.duration.glide, easing: Motion.easing.out })
      );
      runOnJS(skip)(e.translationX < 0 ? 'next' : 'previous');
    });

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: tintSv.value,
    transform: [{ translateY: enter.value }, { scale: bump.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
    opacity: 1 - Math.min(Math.abs(swipeX.value) / (width * 0.6), 0.7),
  }));

  if (!currentTrack) return null;
  const channel = currentTrack.channel_name || currentTrack.channelName || currentTrack.artist;

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.trackArea, contentStyle]}>
          <Pressable
            onPress={() => {
              tapHaptic();
              onOpenNowPlaying();
            }}
            style={styles.trackPressable}
            accessibilityRole="button"
            accessibilityLabel={`Now playing: ${currentTrack.title} by ${channel}. Open player`}
          >
            <View ref={thumbRef} collapsable={false}>
              <Image source={thumbnail ? { uri: thumbnail } : undefined} style={styles.thumb} contentFit="cover" transition={Motion.duration.base} />
            </View>
            <View style={styles.meta}>
              <Text variant="captionStrong" color={fg} numberOfLines={1}>{currentTrack.title}</Text>
              <Text variant="caption" color={fgSub} numberOfLines={1}>{channel}</Text>
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>

      <View style={styles.controls}>
        <LikeButton
          isLiked={isLiked}
          size={21}
          idleColor={fgSub}
          onToggle={() => {
            successHaptic();
            void setLiked(playback.trackToSong(currentTrack), !isLiked);
          }}
        />
        <Pressable
          onPress={() => {
            tapHaptic();
            void playback.togglePlay();
          }}
          hitSlop={6}
          style={styles.control}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        >
          {isLoading && !isPlaying ? <ActivityIndicator color={fg} size="small" /> : <PlayPauseIcon playing={isPlaying} size={26} color={fg} />}
        </Pressable>
        <Pressable onPress={() => skip('next')} hitSlop={6} style={styles.control} accessibilityRole="button" accessibilityLabel="Next song">
          <Ionicons name="play-skip-forward" size={20} color={fg} />
        </Pressable>
      </View>

      <ProgressLine color={isDark ? '#FFFFFF' : colors.accentInk} track={isDark ? 'rgba(255,255,255,0.18)' : 'rgba(11,15,26,0.1)'} />
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flexDirection: 'row',
    height: Layout.miniPlayerHeight - Space[2],
    marginHorizontal: Space[2],
    overflow: 'hidden',
    paddingLeft: Space[2],
    paddingRight: Space[1],
    ...(t.isDark ? {} : { borderColor: t.colors.border, borderWidth: 1 }),
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: t.isDark ? 0.45 : 0.12,
    shadowRadius: 18,
    elevation: 10,
  },
  trackArea: { flex: 1, height: '100%' },
  trackPressable: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: Space[3] },
  thumb: { borderRadius: Radius.xs + 2, height: 42, width: 42 },
  meta: { flex: 1, minWidth: 0 },
  controls: { alignItems: 'center', flexDirection: 'row' },
  control: { alignItems: 'center', height: Layout.touchTarget, justifyContent: 'center', width: 40 },
}));
