import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import TrackPlayer from '../services/trackPlayerShim';
import { togglePlayback as audioToggle } from '../services/audioPlayer';
import { usePlayerStore } from '../store/playerStore';
import SafeBlurView from './SafeBlurView';
import EqualizerBars from './EqualizerBars';

type MiniPlayerProps = {
  onOpenNowPlaying: () => void;
};

const MINI_PLAYER_HEIGHT = 64;
const MORPH_DURATION_MS = 180;
const PRESS_SPRING = {
  damping: 15,
  stiffness: 200,
};

export default function MiniPlayer({ onOpenNowPlaying }: MiniPlayerProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const translateY = useSharedValue(MINI_PLAYER_HEIGHT);
  const playPauseScale = useSharedValue(1);
  const playPauseProgress = useSharedValue(isPlaying ? 1 : 0);
  const visualIsPlayingRef = useRef(isPlaying);

  useEffect(() => {
    if (!currentTrack) {
      translateY.value = MINI_PLAYER_HEIGHT;
      return;
    }

    translateY.value = MINI_PLAYER_HEIGHT;
    translateY.value = withTiming(0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [currentTrack, translateY]);

  useEffect(() => {
    visualIsPlayingRef.current = isPlaying;
    playPauseProgress.value = withTiming(isPlaying ? 1 : 0, {
      duration: MORPH_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [isPlaying, playPauseProgress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const playPauseButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playPauseScale.value }],
  }));

  const playIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - playPauseProgress.value,
    transform: [{ scale: 1 - playPauseProgress.value * 0.3 }],
  }));

  const pauseIconStyle = useAnimatedStyle(() => ({
    opacity: playPauseProgress.value,
    transform: [{ scale: 0.7 + playPauseProgress.value * 0.3 }],
  }));

  if (!currentTrack) {
    return null;
  }

  const thumbnailSource = currentTrack.thumbnail_url || currentTrack.thumbnailUrl || currentTrack.artwork;
  const channelName = currentTrack.channel_name || currentTrack.channelName || currentTrack.artist;

  const handleTogglePlay = async () => {
    const nowPlaying = await audioToggle();
    usePlayerStore.setState({ isPlaying: nowPlaying });
  };

  const handlePlayPausePressIn = () => {
    playPauseScale.value = withSpring(0.88, PRESS_SPRING);
  };

  const handlePlayPausePressOut = () => {
    playPauseScale.value = withSpring(1, PRESS_SPRING);
  };

  const handlePlayPausePress = () => {
    visualIsPlayingRef.current = !visualIsPlayingRef.current;
    playPauseProgress.value = withTiming(visualIsPlayingRef.current ? 1 : 0, {
      duration: MORPH_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
    void handleTogglePlay();
  };

  const handleNext = async () => {
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // Ignore queue boundary errors in the compact player.
    }
  };

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <SafeBlurView
        blurAmount={24}
        blurType="dark"
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.progressTrack} pointerEvents="none">
        <View style={styles.progressFill} />
      </View>

      <Pressable style={styles.trackArea} onPress={onOpenNowPlaying}>
        <Image
          source={thumbnailSource ? { uri: thumbnailSource } : undefined}
          style={styles.thumbnail}
          contentFit="cover"
        />
        <View style={styles.nowPlayingIndicator}>
          <EqualizerBars isPlaying={isPlaying} size="sm" />
        </View>
        <View style={styles.textContainer}>
          <Text numberOfLines={1} style={styles.title}>
            {currentTrack.title}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {channelName}
          </Text>
        </View>
      </Pressable>

      <View style={styles.controls}>
        <Pressable
          hitSlop={10}
          onPress={handlePlayPausePress}
          onPressIn={handlePlayPausePressIn}
          onPressOut={handlePlayPausePressOut}
        >
          <Animated.View style={[styles.playPauseTouchTarget, playPauseButtonStyle]}>
            <View style={styles.playPauseIconContainer}>
              <Animated.View style={[styles.playPauseIconLayer, playIconStyle]}>
                <Ionicons name="play" size={24} color="#FFFFFF" style={styles.playIconOffset} />
              </Animated.View>
              <Animated.View style={[styles.playPauseIconLayer, pauseIconStyle]}>
                <Ionicons name="pause" size={24} color="#FFFFFF" />
              </Animated.View>
            </View>
          </Animated.View>
        </Pressable>
        <Pressable hitSlop={10} onPress={() => void handleNext()}>
          <Ionicons name="play-skip-forward" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

export { MINI_PLAYER_HEIGHT };

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    height: MINI_PLAYER_HEIGHT,
    marginHorizontal: 8,
    overflow: 'hidden',
    paddingHorizontal: 12,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  progressFill: {
    width: '35%',
    height: 2,
    backgroundColor: '#7C3AED',
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
  },
  trackArea: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: '100%',
  },
  thumbnail: {
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  nowPlayingIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 2,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    paddingRight: 4,
  },
  playPauseTouchTarget: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  playPauseIconContainer: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  playPauseIconLayer: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    width: 24,
  },
  playIconOffset: {
    marginLeft: 2,
  },
});
