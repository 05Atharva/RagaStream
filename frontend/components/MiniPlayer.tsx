import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Svg, { Circle } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
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
const CAPSULE_HEIGHT = Layout.miniPlayerHeight - Space[2];
const RING_SIZE = 48;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const ART_SIZE = 40;
const PEEK = 7;
const RELEASE_MS = 900;

type AnyTrack = NonNullable<ReturnType<typeof usePlayerStore.getState>['currentTrack']>;

function artworkOf(track: AnyTrack | null | undefined): string | null {
  if (!track) return null;
  return track.thumbnail_url || track.thumbnailUrl || track.artwork || null;
}

/** Round artwork wrapped in its progress ring. The ring is the progress. */
function ArtworkRing({
  uri,
  color,
  track,
  thumbRef,
}: {
  uri: string | null;
  color: string;
  track: string;
  thumbRef: React.RefObject<View | null>;
}) {
  const position = usePlayerStore((s) => s.currentPosition);
  const duration = usePlayerStore((s) => s.duration);
  const ratio = duration > 0 ? Math.min(Math.max(position / duration, 0), 1) : 0;
  const styles = useStyles();
  const c = RING_SIZE / 2;
  return (
    <View style={styles.ring}>
      <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ringSvg} pointerEvents="none">
        <Circle cx={c} cy={c} r={RING_RADIUS} stroke={track} strokeWidth={RING_STROKE} fill="none" />
        <Circle
          cx={c}
          cy={c}
          r={RING_RADIUS}
          stroke={color}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
          strokeDashoffset={RING_LENGTH * (1 - ratio)}
          rotation={-90}
          origin={`${c}, ${c}`}
        />
      </Svg>
      <View ref={thumbRef} collapsable={false}>
        <Image source={uri ? { uri } : undefined} style={styles.thumb} contentFit="cover" transition={Motion.duration.base} />
      </View>
    </View>
  );
}

/**
 * The mini player is a floating capsule tinted with the current artwork's
 * colour, its progress drawn as a ring around the artwork. The next song peeks
 * out above it like the edge of a deck; a swipe sends the capsule off and
 * promotes that card forward. It rises on the first track, crossfades its tint
 * between songs, and catches queued songs (glide flights) with a small bump.
 */
export default function MiniPlayer({ onOpenNowPlaying }: MiniPlayerProps) {
  const styles = useStyles();
  const colors = useColors();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const nextTrack = usePlayerStore((s) => s.userQueue[0] ?? s.queue[s.currentIndex + 1] ?? null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const arrivals = useFlightArrivals();

  const thumbnail = artworkOf(currentTrack);
  const palette = useArtworkColor(thumbnail);
  const nextPalette = useArtworkColor(artworkOf(nextTrack as AnyTrack | null));
  const youtubeId = currentTrack ? playback.getYoutubeId(currentTrack) : null;
  const isLiked = useIsLiked(youtubeId);

  // Dark: deep artwork tint with light text. Light: pale artwork wash with ink text.
  const tint = isDark ? palette.background : mix(palette.accent, '#FFFFFF', 0.84);
  const edgeTint = isDark ? nextPalette.background : mix(nextPalette.accent, '#FFFFFF', 0.84);
  const fg = isDark ? '#FFFFFF' : colors.text;
  const fgSub = isDark ? 'rgba(255,255,255,0.7)' : colors.textSecondary;

  const enter = useSharedValue(reduced ? 0 : Layout.miniPlayerHeight + 24);
  const bump = useSharedValue(1);
  const swipeX = useSharedValue(0);
  const frontShow = useSharedValue(1); // 0 while a skip is in flight, then fades back in
  const promote = useSharedValue(0); // 0 = peek pose, 1 = full front pose
  const hasNext = useSharedValue(nextTrack ? 1 : 0);
  const tintSv = useSharedValue<string>(tint);
  const edgeTintSv = useSharedValue<string>(edgeTint);
  const thumbRef = useRef<View>(null);
  const entered = useRef(false);
  const pending = useRef<'next' | 'previous' | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentTrack || entered.current) return;
    entered.current = true;
    enter.value = withTiming(0, { duration: Motion.duration.slow, easing: Motion.easing.out });
  }, [currentTrack, enter]);

  useEffect(() => {
    tintSv.value = withTiming(tint, { duration: Motion.duration.slow, easing: Motion.easing.standard });
  }, [tint, tintSv]);

  // While a skip is promoting the edge card, keep its tint: it becomes the new capsule.
  useEffect(() => {
    if (pending.current) return;
    edgeTintSv.value = withTiming(edgeTint, { duration: Motion.duration.slow, easing: Motion.easing.standard });
  }, [edgeTint, edgeTintSv, nextTrack]);

  useEffect(() => {
    hasNext.value = withTiming(nextTrack ? 1 : 0, { duration: Motion.duration.base, easing: Motion.easing.standard });
  }, [nextTrack, hasNext]);

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

  // The new song's capsule settles in after a skip (forward: from the promoted pose; back: from the left).
  const settle = (direction: 'next' | 'previous') => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
    pending.current = null;
    promote.value = 0;
    edgeTintSv.value = edgeTint;
    if (reduced) {
      swipeX.value = 0;
    } else {
      swipeX.value = direction === 'next' ? 0 : -width * 0.12;
      swipeX.value = withTiming(0, { duration: Motion.duration.glide, easing: Motion.easing.out });
    }
    frontShow.value = withTiming(1, {
      duration: reduced ? Motion.duration.base : Motion.duration.glide,
      easing: Motion.easing.out,
    });
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  const lastId = useRef(youtubeId);
  useEffect(() => {
    if (lastId.current === youtubeId) return;
    lastId.current = youtubeId;
    if (pending.current) settleRef.current(pending.current);
  }, [youtubeId]);

  const skip = (direction: 'next' | 'previous') => {
    gestureHaptic();
    void (direction === 'next' ? playback.next() : playback.previous());
  };

  // Leave finished: request the skip and hold the stage until the new track arrives.
  const commitSkip = (direction: 'next' | 'previous') => {
    pending.current = direction;
    frontShow.value = 0;
    skip(direction);
    // If nothing changed (end of queue), bring the capsule back.
    releaseTimer.current = setTimeout(() => {
      if (pending.current) settleRef.current(pending.current);
    }, RELEASE_MS);
  };

  const swipe = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      if (!reduced) swipeX.value = e.translationX;
    })
    .onEnd((e) => {
      const commit = Math.abs(e.translationX) > width * SWIPE_COMMIT_RATIO || Math.abs(e.velocityX) > 800;
      if (!commit) {
        swipeX.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out });
        return;
      }
      const direction = e.translationX < 0 ? 'next' : 'previous';
      if (reduced) {
        runOnJS(commitSkip)(direction);
        return;
      }
      const exit = direction === 'next' ? -width : width;
      // The capsule leaves on `in`; going forward, the edge card promotes on `out` as it goes.
      swipeX.value = withTiming(exit, { duration: Motion.duration.quick, easing: Motion.easing.in }, (finished) => {
        if (finished) runOnJS(commitSkip)(direction);
      });
      if (direction === 'next' && hasNext.value > 0) {
        promote.value = withDelay(
          Motion.duration.quick * 0.4,
          withTiming(1, { duration: Motion.duration.glide, easing: Motion.easing.out })
        );
      }
    });

  const wrapperStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: enter.value }, { scale: bump.value }],
  }));
  const frontStyle = useAnimatedStyle(() => ({
    backgroundColor: tintSv.value,
    transform: [{ translateX: swipeX.value }],
    opacity: frontShow.value * (1 - Math.min(Math.abs(swipeX.value) / (width * 0.6), 0.7)),
  }));
  const edgeStyle = useAnimatedStyle(() => ({
    backgroundColor: edgeTintSv.value,
    opacity: (0.6 + 0.4 * promote.value) * (promote.value > 0 ? 1 : hasNext.value),
    transform: [{ translateY: -PEEK * (1 - promote.value) }, { scale: 0.94 + 0.06 * promote.value }],
  }));

  if (!currentTrack) return null;
  const channel = currentTrack.channel_name || currentTrack.channelName || currentTrack.artist;

  return (
    <Animated.View style={[styles.wrapper, wrapperStyle]}>
      <Animated.View pointerEvents="none" style={[styles.edge, edgeStyle]} />
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.capsule, frontStyle]}>
          <Pressable
            onPress={() => {
              tapHaptic();
              onOpenNowPlaying();
            }}
            style={styles.trackPressable}
            accessibilityRole="button"
            accessibilityLabel={`Now playing: ${currentTrack.title} by ${channel}. Open player`}
          >
            <ArtworkRing
              uri={thumbnail}
              thumbRef={thumbRef}
              color={isDark ? '#FFFFFF' : colors.accentInk}
              track={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(11,15,26,0.2)'}
            />
            <View style={styles.meta}>
              <Text variant="captionStrong" color={fg} numberOfLines={1}>{currentTrack.title}</Text>
              <Text variant="caption" color={fgSub} numberOfLines={1}>{channel}</Text>
            </View>
          </Pressable>

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
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  wrapper: {
    height: CAPSULE_HEIGHT,
    marginHorizontal: Space[3],
  },
  edge: {
    borderRadius: Radius.pill,
    height: CAPSULE_HEIGHT,
    left: '4%',
    position: 'absolute',
    right: '4%',
    top: 0,
    ...(t.isDark ? {} : { borderColor: t.colors.border, borderWidth: 1 }),
  },
  capsule: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    height: CAPSULE_HEIGHT,
    paddingLeft: Space[1],
    paddingRight: Space[1],
    ...(t.isDark ? {} : { borderColor: t.colors.border, borderWidth: 1 }),
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: t.isDark ? 0.45 : 0.12,
    shadowRadius: 18,
    elevation: 10,
  },
  trackPressable: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: Space[3], height: '100%' },
  ring: { alignItems: 'center', height: RING_SIZE, justifyContent: 'center', width: RING_SIZE },
  ringSvg: { position: 'absolute' },
  thumb: { borderRadius: Radius.pill, height: ART_SIZE, width: ART_SIZE },
  meta: { flex: 1, minWidth: 0 },
  controls: { alignItems: 'center', flexDirection: 'row' },
  control: { alignItems: 'center', height: Layout.touchTarget, justifyContent: 'center', width: 40 },
}));
