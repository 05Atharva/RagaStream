import React, { useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from '@react-native-community/blur';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import {
  PanGestureHandler,
  type PanGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import TrackPlayer from 'react-native-track-player';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore } from '../store/playerStore';

const DISMISS_THRESHOLD = 120;
const MIN_ART_PADDING = 48;

type ProgressState = {
  position: number;
  duration: number;
};

type MarqueeTextProps = {
  text: string;
  style: StyleProp<TextStyle>;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function MarqueeText({ text, style }: MarqueeTextProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(translateX);
    translateX.value = 0;

    if (!containerWidth || !textWidth || textWidth <= containerWidth) {
      return;
    }

    const delta = textWidth - containerWidth + 24;
    translateX.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1200 }),
        withTiming(-delta, {
          duration: Math.max(3500, delta * 22),
          easing: Easing.linear,
        }),
        withTiming(0, { duration: 0 })
      ),
      -1,
      false
    );
  }, [containerWidth, textWidth, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)} style={styles.marqueeMask}>
      <Animated.Text
        numberOfLines={1}
        onLayout={(event) => setTextWidth(event.nativeEvent.layout.width)}
        style={[style, animatedStyle]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

export default function NowPlayingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width } = useWindowDimensions();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const setRepeat = usePlayerStore((state) => state.setRepeat);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const setPosition = usePlayerStore((state) => state.setPosition);
  const setDuration = usePlayerStore((state) => state.setDuration);
  const [progress, setProgress] = useState<ProgressState>({ position: 0, duration: 0 });
  const translateY = useSharedValue(0);

  const albumSize = Math.min(width - MIN_ART_PADDING, Dimensions.get('window').width - MIN_ART_PADDING);

  useEffect(() => {
    let isMounted = true;

    const syncProgress = async () => {
      try {
        const nextProgress = await TrackPlayer.getProgress();
        if (!isMounted) {
          return;
        }

        setProgress({
          position: nextProgress.position,
          duration: nextProgress.duration,
        });
        setPosition(nextProgress.position);
        setDuration(nextProgress.duration);
      } catch {
        // Ignore progress polling failures while the player is idle.
      }
    };

    void syncProgress();
    const interval = setInterval(() => {
      void syncProgress();
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [setDuration, setPosition]);

  const dismiss = () => {
    navigation.goBack();
  };

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onActive: (event) => {
      translateY.value = Math.max(0, event.translationY);
    },
    onEnd: () => {
      if (translateY.value > DISMISS_THRESHOLD) {
        translateY.value = withTiming(Dimensions.get('window').height, { duration: 180 }, (finished) => {
          if (finished) {
            runOnJS(dismiss)();
          }
        });
        return;
      }

      translateY.value = withSpring(0, {
        damping: 18,
        stiffness: 180,
      });
    },
  });

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const thumbnailSource = useMemo(() => {
    if (!currentTrack) {
      return undefined;
    }

    return (
      currentTrack.thumbnail_url ||
      currentTrack.thumbnailUrl ||
      currentTrack.artwork ||
      undefined
    );
  }, [currentTrack]);

  const channelName = currentTrack?.channel_name || currentTrack?.channelName || currentTrack?.artist || '';

  if (!currentTrack) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <Pressable hitSlop={8} onPress={dismiss} style={styles.closeButton}>
          <Ionicons name="chevron-down" size={24} color={Colors.onBackground} />
        </Pressable>
      </SafeAreaView>
    );
  }

  const togglePlayback = async () => {
    if (isPlaying) {
      await TrackPlayer.pause();
      usePlayerStore.setState({ isPlaying: false });
      return;
    }

    await TrackPlayer.play();
    usePlayerStore.setState({ isPlaying: true });
  };

  const skipPrevious = async () => {
    try {
      await TrackPlayer.skipToPrevious();
    } catch {
      // Ignore queue boundary errors in the full player.
    }
  };

  const skipNext = async () => {
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // Ignore queue boundary errors in the full player.
    }
  };

  const handleSeekComplete = async (value: number) => {
    await TrackPlayer.seekTo(value);
    setProgress((prev) => ({ ...prev, position: value }));
    setPosition(value);
  };

  const cycleRepeatMode = async () => {
    const nextMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    await setRepeat(nextMode);
  };

  return (
    <PanGestureHandler onGestureEvent={gestureHandler}>
      <Animated.View style={[styles.flex, containerAnimatedStyle]}>
        <SafeAreaView style={styles.container}>
          {thumbnailSource ? (
            <>
              <Image source={{ uri: thumbnailSource }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              <BlurView
                blurAmount={32}
                blurType="dark"
                reducedTransparencyFallbackColor={Colors.background}
                style={StyleSheet.absoluteFillObject}
              />
            </>
          ) : null}
          <View style={styles.overlay} />

          <View style={styles.header}>
            <Pressable hitSlop={8} onPress={dismiss} style={styles.closeButton}>
              <Ionicons name="chevron-down" size={24} color={Colors.onBackground} />
            </Pressable>
          </View>

          <View style={styles.content}>
            <View style={[styles.artworkWrapper, { width: albumSize, height: albumSize }]}>
              <Image
                source={thumbnailSource ? { uri: thumbnailSource } : undefined}
                style={styles.artwork}
                contentFit="cover"
              />
              <View style={styles.youtubeBadge}>
                <Ionicons name="logo-youtube" size={14} color={Colors.onBackground} />
              </View>
            </View>

            <View style={styles.metaSection}>
              <MarqueeText text={currentTrack.title} style={styles.title} />
              <Text numberOfLines={1} style={styles.channelName}>
                {channelName}
              </Text>
            </View>

            <View style={styles.seekSection}>
              <Slider
                value={progress.position}
                minimumValue={0}
                maximumValue={Math.max(progress.duration, 1)}
                minimumTrackTintColor={Colors.primary}
                maximumTrackTintColor="#555555"
                thumbTintColor={Colors.primaryLight}
                onSlidingComplete={(value) => void handleSeekComplete(value)}
              />
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
                <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
              </View>
            </View>

            <View style={styles.controlsRow}>
              <Pressable hitSlop={8} onPress={() => void skipPrevious()} style={styles.transportButton}>
                <Ionicons name="play-skip-back" size={32} color={Colors.onBackground} />
              </Pressable>

              <Pressable hitSlop={8} onPress={() => void togglePlayback()} style={styles.playPauseButton}>
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={28}
                  color={Colors.onPrimary}
                  style={!isPlaying ? styles.playIconOffset : undefined}
                />
              </Pressable>

              <Pressable hitSlop={8} onPress={() => void skipNext()} style={styles.transportButton}>
                <Ionicons name="play-skip-forward" size={32} color={Colors.onBackground} />
              </Pressable>
            </View>

            <View style={styles.actionsRow}>
              <Pressable style={styles.actionButton}>
                <Ionicons name="heart-outline" size={24} color={Colors.onBackground} />
              </Pressable>
              <Pressable style={styles.actionButton}>
                <Ionicons name="add-circle-outline" size={24} color={Colors.onBackground} />
              </Pressable>
              <Pressable style={styles.actionButton}>
                <Ionicons name="list-outline" size={24} color={Colors.onBackground} />
              </Pressable>
              <Pressable style={styles.actionButton} onPress={toggleShuffle}>
                <Ionicons
                  name="shuffle"
                  size={24}
                  color={shuffle ? Colors.primaryLight : Colors.onBackground}
                />
              </Pressable>
              <Pressable style={styles.actionButton} onPress={() => void cycleRepeatMode()}>
                <Ionicons
                  name={repeatMode === 'one' ? 'repeat-outline' : 'repeat'}
                  size={24}
                  color={repeatMode === 'off' ? Colors.onBackground : Colors.primaryLight}
                />
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Animated.View>
    </PanGestureHandler>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  emptyState: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18, 18, 18, 0.72)',
  },
  header: {
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    zIndex: 1,
  },
  closeButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  content: {
    flex: 1,
    justifyContent: 'space-evenly',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  artworkWrapper: {
    alignSelf: 'center',
    position: 'relative',
  },
  artwork: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    height: '100%',
    width: '100%',
  },
  youtubeBadge: {
    alignItems: 'center',
    backgroundColor: '#FF0000',
    borderRadius: BorderRadius.full,
    bottom: 12,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    width: 28,
  },
  metaSection: {
    gap: Spacing.sm,
  },
  marqueeMask: {
    overflow: 'hidden',
    width: '100%',
  },
  title: {
    color: Colors.onBackground,
    fontSize: 20,
    fontWeight: Typography.fontWeightBold,
    textAlign: 'center',
  },
  channelName: {
    color: '#AAAAAA',
    fontSize: 14,
    textAlign: 'center',
  },
  seekSection: {
    gap: Spacing.xs,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  timeText: {
    color: '#AAAAAA',
    fontSize: 12,
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  transportButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  playPauseButton: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.full,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  playIconOffset: {
    marginLeft: 2,
  },
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});
