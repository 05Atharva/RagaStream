import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import FlipArtwork, { EXPAND_HIT } from '../FlipArtwork';
import { gestureHaptic, tapHaptic } from '../../services/haptics';
import { usePlayerStore, type Track } from '../../store/playerStore';
import { Motion, Radius } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import type { Lyrics } from '../../hooks/useLyrics';

const COMMIT_RATIO = 0.22;
const COMMIT_VELOCITY = 800;
const EXIT_MS = 220;
const FLY_DROP = 40;
const FLY_TILT = 18;
const FLY_REACH = 1.3;
const NO_CHANGE_MS = 700;

export type DeckDirection = 'next' | 'previous';

export type DeckArtworkHandle = {
  /** Run the same flick the pan gesture does (used by the transport buttons). */
  flick: (direction: DeckDirection) => void;
};

export type DeckArtworkProps = {
  thumbnail?: string;
  size: number;
  trackKey: string;
  title: string;
  lyrics: Lyrics | null | undefined;
  lyricsLoading: boolean;
  lyricsError: boolean;
  /** Back face fill and the inks that read on it (artwork-derived). */
  background: string;
  ink: string;
  dim: string;
  onExpand: () => void;
  onNext: () => void;
  onPrevious: () => void;
};

function thumbOf(track: Track | undefined): string | undefined {
  if (!track) return undefined;
  return track.thumbnail_url || track.thumbnailUrl || track.artwork || undefined;
}

/**
 * The deck: the current song is the top card (tap to turn it over for
 * lyrics), the next two wait behind it. Flick sideways to skip: the card flies
 * off on an arc and the next one promotes forward.
 */
const DeckArtwork = forwardRef<DeckArtworkHandle, DeckArtworkProps>(function DeckArtwork(
  { thumbnail, size, trackKey, title, lyrics, lyricsLoading, lyricsError, background, ink, dim, onExpand, onNext, onPrevious },
  ref
) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const userQueue = usePlayerStore((s) => s.userQueue);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const upcoming = [...userQueue, ...queue.slice(currentIndex + 1)].slice(0, 2);
  const back1Thumb = thumbOf(upcoming[0]);
  const back2Thumb = thumbOf(upcoming[1]);
  const hasBack1 = upcoming.length > 0;
  const hasBack2 = upcoming.length > 1;

  const [flipped, setFlipped] = useState(false);
  const [screenWidth, setScreenWidth] = useState(size);

  const x = useSharedValue(0);
  /** 0 = top card still sits in the back1 pose, 1 = at rest in front. */
  const enter = useSharedValue(1);
  const fade = useSharedValue(1);
  const busy = useSharedValue(false);
  const breath = useSharedValue(1);
  const width = useSharedValue(size);

  const pending = useRef<DeckDirection | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKey = useRef(trackKey);
  const callbacks = useRef({ onNext, onPrevious });
  callbacks.current = { onNext, onPrevious };

  useEffect(() => {
    width.value = screenWidth;
  }, [screenWidth, width]);

  useEffect(() => {
    breath.value = withTiming(isPlaying || reduced ? 1 : 0.95, {
      duration: isPlaying ? Motion.duration.slow : Motion.duration.glide,
      easing: Motion.easing.glide,
    });
  }, [breath, isPlaying, reduced]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const settle = useCallback(() => {
    pending.current = null;
    if (reduced) {
      fade.value = withTiming(1, { duration: Motion.duration.quick });
    } else {
      x.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out });
    }
    busy.value = false;
  }, [busy, fade, reduced, x]);

  // The exit has finished: ask the controller to change track, then wait for
  // the new currentTrack to promote (or settle back if nothing changes).
  const commit = useCallback(
    (direction: DeckDirection) => {
      pending.current = direction;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pending.current === direction) settle();
      }, NO_CHANGE_MS);
      if (direction === 'next') callbacks.current.onNext();
      else callbacks.current.onPrevious();
    },
    [settle]
  );

  const fly = (direction: DeckDirection) => {
    'worklet';
    if (busy.value) return;
    busy.value = true;
    runOnJS(gestureHaptic)();
    if (reduced) {
      fade.value = withTiming(0, { duration: Motion.duration.quick }, (finished) => {
        if (finished) runOnJS(commit)(direction);
      });
      return;
    }
    const target = (direction === 'next' ? -1 : 1) * width.value * FLY_REACH;
    x.value = withTiming(target, { duration: EXIT_MS, easing: Motion.easing.in }, (finished) => {
      if (finished) runOnJS(commit)(direction);
    });
  };

  const flickFromJs = (direction: DeckDirection) => fly(direction);
  useImperativeHandle(ref, () => ({ flick: flickFromJs }));

  // New current track: promote the new top card (a flick, or an auto-advance).
  useEffect(() => {
    if (lastKey.current === trackKey) return;
    lastKey.current = trackKey;
    const direction = pending.current;
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    setFlipped(false);
    cancelAnimation(x);
    cancelAnimation(enter);
    cancelAnimation(fade);
    if (reduced) {
      x.value = 0;
      enter.value = 1;
      fade.value = 0;
      fade.value = withTiming(1, { duration: Motion.duration.quick });
    } else if (direction === 'previous') {
      enter.value = 1;
      x.value = -width.value * FLY_REACH;
      x.value = withTiming(0, { duration: Motion.duration.glide, easing: Motion.easing.out });
    } else {
      x.value = 0;
      enter.value = 0;
      enter.value = withTiming(1, { duration: Motion.duration.glide, easing: Motion.easing.out });
    }
    busy.value = false;
  }, [busy, enter, fade, reduced, trackKey, width, x]);

  const toggleFlip = () => {
    tapHaptic();
    setFlipped((f) => !f);
  };

  // On the lyrics side, the top-right corner opens full-screen lyrics.
  const handleTap = (tx: number, ty: number) => {
    if (flipped && lyrics && tx > size - EXPAND_HIT && ty < EXPAND_HIT) {
      tapHaptic();
      onExpand();
      return;
    }
    toggleFlip();
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      if (busy.value || reduced) return;
      x.value = e.translationX;
    })
    .onEnd((e) => {
      if (busy.value) return;
      const commitSwipe = Math.abs(e.translationX) > width.value * COMMIT_RATIO || Math.abs(e.velocityX) > COMMIT_VELOCITY;
      if (!commitSwipe) {
        x.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out });
        return;
      }
      const goesNext = e.translationX !== 0 ? e.translationX < 0 : e.velocityX < 0;
      fly(goesNext ? 'next' : 'previous');
    });

  const tap = Gesture.Tap()
    .maxDuration(450)
    .maxDistance(12)
    .onEnd((e, success) => {
      if (success) runOnJS(handleTap)(e.x, e.y);
    });

  const topStyle = useAnimatedStyle(() => {
    const w = width.value;
    const reach = w * FLY_REACH;
    const dropT = interpolate(Math.abs(x.value), [0, reach], [0, FLY_DROP], 'clamp');
    const tilt = interpolate(x.value, [-reach, -w, w, reach], [-FLY_TILT, -12, 12, FLY_TILT]);
    return {
      opacity: interpolate(enter.value, [0, 1], [0.75, 1]) * fade.value,
      transform: [
        { translateX: x.value },
        { translateY: interpolate(enter.value, [0, 1], [12, 0]) + dropT },
        { rotate: `${tilt}deg` },
        { scale: interpolate(enter.value, [0, 1], [0.93, 1]) },
      ],
    };
  });
  const back1Style = useAnimatedStyle(() => ({
    opacity: interpolate(enter.value, [0, 1], [0.45, 0.75]),
    transform: [{ translateY: interpolate(enter.value, [0, 1], [24, 12]) }, { scale: interpolate(enter.value, [0, 1], [0.86, 0.93]) }],
  }));
  const back2Style = useAnimatedStyle(() => ({
    opacity: interpolate(enter.value, [0, 1], [0, 0.45]),
    transform: [{ translateY: interpolate(enter.value, [0, 1], [36, 24]) }, { scale: interpolate(enter.value, [0, 1], [0.8, 0.86]) }],
  }));
  const deckStyle = useAnimatedStyle(() => ({ transform: [{ scale: breath.value }] }));

  const card = { width: size, height: size, borderRadius: Radius.lg, position: 'absolute' as const, top: 0, left: 0 };
  const placeholder = colors.surfaceRaised;

  return (
    <Animated.View
      onLayout={(e) => setScreenWidth(e.nativeEvent.layout.width || size)}
      style={[{ alignItems: 'center', alignSelf: 'stretch', height: size + 28 }, deckStyle]}
    >
      <View style={{ width: size, height: size + 28 }}>
        {hasBack2 ? (
          <Animated.View pointerEvents="none" style={[card, { backgroundColor: placeholder }, back2Style]}>
            <Image source={back2Thumb ? { uri: back2Thumb } : undefined} style={{ width: size, height: size, borderRadius: Radius.lg }} contentFit="cover" />
          </Animated.View>
        ) : null}
        {hasBack1 ? (
          <Animated.View pointerEvents="none" style={[card, { backgroundColor: placeholder }, back1Style]}>
            <Image source={back1Thumb ? { uri: back1Thumb } : undefined} style={{ width: size, height: size, borderRadius: Radius.lg }} contentFit="cover" />
          </Animated.View>
        ) : null}
        <GestureDetector gesture={Gesture.Race(pan, tap)}>
          <Animated.View
            style={[{ width: size, height: size }, topStyle]}
            accessible
            accessibilityRole="button"
            accessibilityLabel={flipped ? 'Lyrics. Double tap to show the artwork.' : `Artwork for ${title}. Double tap to show lyrics, swipe to skip.`}
            accessibilityActions={[
              { name: 'activate' },
              { name: 'increment', label: 'Next song' },
              { name: 'decrement', label: 'Previous song' },
              ...(lyrics ? [{ name: 'expand', label: 'Open full lyrics' }] : []),
            ]}
            onAccessibilityAction={(e) => {
              const name = e.nativeEvent.actionName;
              if (name === 'increment') flickFromJs('next');
              else if (name === 'decrement') flickFromJs('previous');
              else if (name === 'expand') onExpand();
              else toggleFlip();
            }}
          >
            <FlipArtwork
              thumbnail={thumbnail}
              size={size}
              flipped={flipped}
              lyrics={lyrics}
              lyricsLoading={lyricsLoading}
              lyricsError={lyricsError}
              background={background}
              ink={ink}
              dim={dim}
            />
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
});

export default DeckArtwork;
