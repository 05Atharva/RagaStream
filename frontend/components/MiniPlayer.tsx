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
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import { usePlayerStore } from '../store/playerStore';

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
    if (isPlaying) {
      await TrackPlayer.pause();
      usePlayerStore.setState({ isPlaying: false });
      return;
    }

    await TrackPlayer.play();
    usePlayerStore.setState({ isPlaying: true });
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

        <View style={styles.spacer} />
      </Pressable>

      <Pressable hitSlop={8} onPress={() => void handleTogglePlay()} style={styles.iconButton}>
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={20}
          color={Colors.onBackground}
        />
      </Pressable>

      <Pressable hitSlop={8} onPress={() => void handleNext()} style={styles.iconButton}>
        <Ionicons name="play-skip-forward" size={20} color={Colors.onBackground} />
      </Pressable>
    </Animated.View>
  );
}

export { MINI_PLAYER_HEIGHT };

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    height: MINI_PLAYER_HEIGHT,
    paddingHorizontal: Spacing.xs,
  },
  trackArea: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: '100%',
  },
  thumbnail: {
    backgroundColor: Colors.border,
    borderRadius: BorderRadius.sm,
    height: 56,
    width: 56,
  },
  textContainer: {
    marginLeft: Spacing.sm,
    minWidth: 0,
  },
  title: {
    color: Colors.onBackground,
    fontSize: 14,
    fontWeight: Typography.fontWeightSemiBold,
  },
  subtitle: {
    color: '#999999',
    fontSize: 12,
    marginTop: 2,
  },
  spacer: {
    flex: 1,
  },
  iconButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    marginLeft: Spacing.xs,
    width: 32,
  },
});
