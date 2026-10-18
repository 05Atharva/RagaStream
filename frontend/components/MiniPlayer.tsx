import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
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
import { Colors, Motion, TypeScale } from '../constants/theme';
import LikeButton from './LikeButton';

type MiniPlayerProps = {
  onOpenNowPlaying: () => void;
};

const MINI_PLAYER_HEIGHT = 64;
const SWIPE_COMMIT_RATIO = 0.25;

/** Thin progress line — its own component so position ticks don't re-render the bar. */
function ProgressLine() {
  const position = usePlayerStore((state) => state.currentPosition);
  const duration = usePlayerStore((state) => state.duration);
  const ratio = duration > 0 ? Math.min(position / duration, 1) : 0;
  return (
    <View style={styles.progressTrack} pointerEvents="none">
      <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
    </View>
  );
}

export default function MiniPlayer({ onOpenNowPlaying }: MiniPlayerProps) {
  const { width } = useWindowDimensions();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoading = usePlayerStore((state) => state.isLoading);

  const thumbnailSource = currentTrack
    ? currentTrack.thumbnail_url || currentTrack.thumbnailUrl || currentTrack.artwork
    : null;
  const palette = useArtworkColor(thumbnailSource);
  const youtubeId = currentTrack ? playback.getYoutubeId(currentTrack) : null;
  const isLiked = useIsLiked(youtubeId);

  const enterY = useSharedValue(MINI_PLAYER_HEIGHT);
  const pressScale = useSharedValue(1);
  const swipeX = useSharedValue(0);
  const tint = useSharedValue<string>(palette.background);
  const hasEnteredRef = useRef(false);

  // Slide up once, the first time a track loads.
  useEffect(() => {
    if (!currentTrack || hasEnteredRef.current) return;
    hasEnteredRef.current = true;
    enterY.value = withTiming(0, { duration: Motion.duration.slow, easing: Motion.easing.decelerate });
  }, [currentTrack, enterY]);

  // Crossfade the artwork tint when the track changes.
  useEffect(() => {
    tint.value = withTiming(palette.background, { duration: Motion.duration.slow });
  }, [palette.background, tint]);

  const skip = (direction: 'next' | 'previous') => {
    gestureHaptic();
    void (direction === 'next' ? playback.next() : playback.previous());
  };

  // Horizontal swipe on the track area skips, like Spotify's mini player.
  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      swipeX.value = event.translationX;
    })
    .onEnd((event) => {
      const commit = Math.abs(event.translationX) > width * SWIPE_COMMIT_RATIO || Math.abs(event.velocityX) > 800;
      if (commit) {
        const direction = event.translationX < 0 ? 'next' : 'previous';
        const exitX = event.translationX < 0 ? -width : width;
        swipeX.value = withSequence(
          withTiming(exitX, { duration: Motion.duration.quick, easing: Motion.easing.accelerate }),
          withTiming(-exitX * 0.4, { duration: 0 }),
          withTiming(0, { duration: Motion.duration.enter, easing: Motion.easing.decelerate })
        );
        runOnJS(skip)(direction);
      } else {
        swipeX.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.standard });
      }
    });

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: tint.value,
    transform: [{ translateY: enterY.value }, { scale: pressScale.value }],
  }));

  const swipeContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
    opacity: 1 - Math.min(Math.abs(swipeX.value) / width, 0.6),
  }));

  if (!currentTrack) {
    return null;
  }

  const channelName = currentTrack.channel_name || currentTrack.channelName || currentTrack.artist;

  const handleToggleLike = () => {
    successHaptic();
    void setLiked(playback.trackToSong(currentTrack), !isLiked);
  };

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <GestureDetector gesture={swipeGesture}>
        <Animated.View style={[styles.trackArea, swipeContentStyle]}>
          <Pressable
            style={styles.trackPressable}
            onPress={onOpenNowPlaying}
            onPressIn={() => {
              pressScale.value = withTiming(0.98, { duration: Motion.duration.fast });
            }}
            onPressOut={() => {
              pressScale.value = withTiming(1, { duration: Motion.duration.quick });
            }}
          >
            <Image
              source={thumbnailSource ? { uri: thumbnailSource } : undefined}
              style={styles.thumbnail}
              contentFit="cover"
              transition={Motion.duration.base}
            />
            <View style={styles.textContainer}>
              <Text numberOfLines={1} style={styles.title}>
                {currentTrack.title}
              </Text>
              <Text numberOfLines={1} style={styles.subtitle}>
                {channelName}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>

      <View style={styles.controls}>
        <LikeButton isLiked={isLiked} onToggle={handleToggleLike} size={22} />
        <Pressable
          hitSlop={10}
          onPress={() => {
            tapHaptic();
            void playback.togglePlay();
          }}
          style={styles.controlButton}
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        >
          {isLoading && !isPlaying ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color="#FFFFFF" />
          )}
        </Pressable>
        <Pressable
          hitSlop={10}
          onPress={() => skip('next')}
          style={styles.controlButton}
          accessibilityLabel="Next track"
        >
          <Ionicons name="play-skip-forward" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      <ProgressLine />
    </Animated.View>
  );
}

export { MINI_PLAYER_HEIGHT };

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    height: MINI_PLAYER_HEIGHT - 8,
    marginHorizontal: 8,
    marginVertical: 4,
    overflow: 'hidden',
    paddingLeft: 8,
    paddingRight: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  trackArea: {
    flex: 1,
    height: '100%',
  },
  trackPressable: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  thumbnail: {
    borderRadius: 8,
    height: 40,
    width: 40,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  title: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  subtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 1,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  controlButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    bottom: 0,
    height: 2,
    left: 8,
    position: 'absolute',
    right: 8,
  },
  progressFill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 2,
  },
});
