import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import TrackPlayer from '../services/trackPlayerShim';
import { togglePlayback as audioToggle } from '../services/audioPlayer';
import { usePlayerStore } from '../store/playerStore';
import SafeBlurView from './SafeBlurView';

type MiniPlayerProps = {
  onOpenNowPlaying: () => void;
};

const MINI_PLAYER_HEIGHT = 64;

export default function MiniPlayer({ onOpenNowPlaying }: MiniPlayerProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const translateY = useSharedValue(MINI_PLAYER_HEIGHT);

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

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
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

  const handleNext = async () => {
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // Ignore queue boundary errors in the compact player.
    }
  };

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      {/* Glass backdrop — 24px blur per DESIGN.md, dark tint */}
      <SafeBlurView
        blurAmount={24}
        blurType="dark"
        style={StyleSheet.absoluteFillObject}
      />

      {/* Top-edge progress line — decorative indicator per DESIGN.md */}
      <View style={styles.progressTrack} pointerEvents="none">
        <View style={styles.progressFill} />
      </View>

      {/* Track info — full tap target opens Now Playing */}
      <Pressable style={styles.trackArea} onPress={onOpenNowPlaying}>
        <Image
          source={thumbnailSource ? { uri: thumbnailSource } : undefined}
          style={styles.thumbnail}
          contentFit="cover"
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

      {/* Playback controls */}
      <View style={styles.controls}>
        <Pressable hitSlop={10} onPress={() => void handleTogglePlay()}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={24}
            color="#FFFFFF"
          />
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
    // Geometry — height must stay 64 to match MINI_PLAYER_HEIGHT export
    alignItems: 'center',
    flexDirection: 'row',
    height: MINI_PLAYER_HEIGHT,
    marginHorizontal: 8,
    overflow: 'hidden',
    paddingHorizontal: 12,
    gap: 12,
    // Glass border — DESIGN.md: 1px white ~10% opacity top edge (full border here for card feel)
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    // Shadow beneath — DESIGN.md glass elevation
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
    // Static width — dynamic progress wiring belongs in a future NowPlaying pass
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
});
