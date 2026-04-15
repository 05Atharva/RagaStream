import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { BottomSheetFlatList, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import {
  PanGestureHandler,
  Swipeable,
  type PanGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import TrackPlayer from '../services/trackPlayerShim';
import Toast from 'react-native-toast-message';
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
import { apiClient } from '../services/apiClient';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePlayerStore, type RepeatModeValue, type Track } from '../store/playerStore';

const DISMISS_THRESHOLD = 120;
const MIN_ART_PADDING = 48;

type ProgressState = {
  position: number;
  duration: number;
};

type SongRecord = {
  id: string;
  youtube_id: string;
  title: string;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
};

type PlaylistRecord = {
  id: string;
  name: string;
  description?: string | null;
  songs?: SongRecord[];
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
  const queue = usePlayerStore((state) => state.queue);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const setRepeat = usePlayerStore((state) => state.setRepeat);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue);
  const setPosition = usePlayerStore((state) => state.setPosition);
  const setDuration = usePlayerStore((state) => state.setDuration);
  const [progress, setProgress] = useState<ProgressState>({ position: 0, duration: 0 });
  const [isLiked, setIsLiked] = useState(false);
  const [resolvedSongId, setResolvedSongId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [isUpdatingLike, setIsUpdatingLike] = useState(false);
  const translateY = useSharedValue(0);
  const heartScale = useSharedValue(1);
  const playlistsSheetRef = useRef<BottomSheetModal>(null);
  const queueSheetRef = useRef<BottomSheetModal>(null);

  const albumSize = Math.min(width - MIN_ART_PADDING, Dimensions.get('window').width - MIN_ART_PADDING);
  const bottomSheetSnapPoints = useMemo(() => ['55%', '82%'], []);

  const thumbnailSource = useMemo(() => {
    if (!currentTrack) {
      return undefined;
    }

    return currentTrack.thumbnail_url || currentTrack.thumbnailUrl || currentTrack.artwork || undefined;
  }, [currentTrack]);

  const channelName = currentTrack?.channel_name || currentTrack?.channelName || currentTrack?.artist || '';
  const youtubeId = currentTrack?.youtube_id || currentTrack?.youtubeId || null;

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

  useEffect(() => {
    let isMounted = true;

    const hydrateLikedState = async () => {
      if (!currentTrack || !youtubeId) {
        setIsLiked(false);
        setResolvedSongId(null);
        return;
      }

      try {
        const { data } = await apiClient.get<SongRecord[]>('/liked');
        if (!isMounted) {
          return;
        }

        const likedMatch = data.find((song) => song.youtube_id === youtubeId);
        setIsLiked(Boolean(likedMatch));
        setResolvedSongId(likedMatch?.id ?? null);
      } catch {
        if (isMounted) {
          setIsLiked(false);
        }
      }
    };

    void hydrateLikedState();

    return () => {
      isMounted = false;
    };
  }, [currentTrack, youtubeId]);

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

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const ensureSongInCatalogue = useCallback(async () => {
    if (!currentTrack || !youtubeId) {
      throw new Error('No current track loaded.');
    }

    if (resolvedSongId) {
      return resolvedSongId;
    }

    const payload = {
      youtube_id: youtubeId,
      title: currentTrack.title,
      channel_name: channelName,
      thumbnail_url: thumbnailSource ?? null,
      duration_sec: Math.floor(progress.duration || 0) || null,
      genre: 'Bollywood',
      language: 'Hindi',
    };

    const { data } = await apiClient.post<SongRecord>('/songs', payload);
    setResolvedSongId(data.id);
    return data.id;
  }, [channelName, currentTrack, progress.duration, resolvedSongId, thumbnailSource, youtubeId]);

  const handleToggleLike = async () => {
    if (isUpdatingLike || !currentTrack) {
      return;
    }

    setIsUpdatingLike(true);
    heartScale.value = withSequence(
      withTiming(1.4, { duration: 100 }),
      withTiming(1, { duration: 100 })
    );

    try {
      const songId = await ensureSongInCatalogue();

      if (isLiked) {
        await apiClient.delete(`/liked/${songId}`);
        setIsLiked(false);
      } else {
        await apiClient.post('/liked', { song_id: songId });
        setIsLiked(true);
      }
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Could not update liked songs',
      });
    } finally {
      setIsUpdatingLike(false);
    }
  };

  const loadPlaylists = useCallback(async () => {
    setIsLoadingPlaylists(true);
    try {
      const { data } = await apiClient.get<Array<{ id: string; name: string; description?: string }>>('/playlists');
      const detailedPlaylists = await Promise.all(
        data.map(async (playlist) => {
          const detail = await apiClient.get<PlaylistRecord>(`/playlists/${playlist.id}`);
          return detail.data;
        })
      );
      setPlaylists(detailedPlaylists);
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Could not load playlists',
      });
    } finally {
      setIsLoadingPlaylists(false);
    }
  }, []);

  const handleOpenPlaylists = async () => {
    playlistsSheetRef.current?.present();
    if (playlists.length === 0) {
      await loadPlaylists();
    }
  };

  const handleAddToPlaylist = async (playlist: PlaylistRecord) => {
    try {
      const songId = await ensureSongInCatalogue();
      await apiClient.post(`/playlists/${playlist.id}/songs`, { song_id: songId });
      playlistsSheetRef.current?.dismiss();
      Toast.show({
        type: 'success',
        text1: `Added to ${playlist.name}`,
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Could not add song to playlist',
      });
    }
  };

  const handleOpenQueue = () => {
    queueSheetRef.current?.present();
  };

  const handleQueueDragEnd = async ({ data }: { data: Track[] }) => {
    await reorderQueue(data);
  };

  const handleRemoveQueueItem = async (trackId: string) => {
    await removeFromQueue(trackId);
  };

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

  const handleShuffleToggle = async () => {
    toggleShuffle();
    const maybeTrackPlayer = TrackPlayer as typeof TrackPlayer & {
      setShuffleMode?: (enabled: boolean) => Promise<void>;
    };

    if (typeof maybeTrackPlayer.setShuffleMode === "function") {
      try {
        await maybeTrackPlayer.setShuffleMode(!shuffle);
      } catch {
        // Keep local shuffle state even when native shuffle support is unavailable.
      }
    }
  };

  const cycleRepeatMode = async () => {
    const nextMode: RepeatModeValue =
      repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    await setRepeat(nextMode);
  };

  const renderPlaylistItem = ({ item }: { item: PlaylistRecord }) => (
    <Pressable onPress={() => void handleAddToPlaylist(item)} style={styles.sheetRow}>
      <View>
        <Text style={styles.sheetRowTitle}>{item.name}</Text>
        <Text style={styles.sheetRowSubtitle}>{item.songs?.length ?? 0} songs</Text>
      </View>
      <Ionicons name="add-circle-outline" size={22} color={Colors.onBackground} />
    </Pressable>
  );

  const renderQueueItem = ({ item, drag, isActive }: RenderItemParams<Track>) => {
    const isCurrent = item.id === currentTrack?.id;
    const rowColor = isCurrent ? 'rgba(124, 58, 237, 0.2)' : Colors.surface;
    const thumbnail = item.thumbnail_url || item.thumbnailUrl || item.artwork;
    const itemChannel = item.channel_name || item.channelName || item.artist;

    return (
      <ScaleDecorator>
        <Swipeable
          renderRightActions={() => (
            <Pressable onPress={() => void handleRemoveQueueItem(item.id)} style={styles.deleteAction}>
              <Ionicons name="trash-outline" size={20} color={Colors.onBackground} />
            </Pressable>
          )}
        >
          <Pressable
            delayLongPress={150}
            onLongPress={drag}
            style={[
              styles.queueRow,
              { backgroundColor: rowColor, opacity: isActive ? 0.9 : 1 },
            ]}
          >
            <Image source={thumbnail ? { uri: thumbnail } : undefined} style={styles.queueThumb} contentFit="cover" />
            <View style={styles.queueMeta}>
              <Text numberOfLines={1} style={styles.queueTitle}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={styles.queueSubtitle}>
                {itemChannel}
              </Text>
            </View>
            <Ionicons name="menu" size={20} color={isCurrent ? Colors.primaryLight : Colors.muted} />
          </Pressable>
        </Swipeable>
      </ScaleDecorator>
    );
  };

  if (!currentTrack) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <Pressable hitSlop={8} onPress={dismiss} style={styles.closeButton}>
          <Ionicons name="chevron-down" size={24} color={Colors.onBackground} />
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <>
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
                <Animated.View style={heartAnimatedStyle}>
                  <Pressable onPress={() => void handleToggleLike()} style={styles.actionButton}>
                    <Ionicons
                      name={isLiked ? 'heart' : 'heart-outline'}
                      size={24}
                      color={isLiked ? Colors.primary : Colors.onBackground}
                    />
                  </Pressable>
                </Animated.View>
                <Pressable onPress={() => void handleOpenPlaylists()} style={styles.actionButton}>
                  <Ionicons name="add-circle-outline" size={24} color={Colors.onBackground} />
                </Pressable>
                <Pressable onPress={handleOpenQueue} style={styles.actionButton}>
                  <Ionicons name="list-outline" size={24} color={Colors.onBackground} />
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => void handleShuffleToggle()}>
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

      <BottomSheetModal
        ref={playlistsSheetRef}
        snapPoints={bottomSheetSnapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetView style={styles.sheetContainer}>
          <Text style={styles.sheetTitle}>Add To Playlist</Text>
          <BottomSheetFlatList
            data={playlists}
            keyExtractor={(item) => item.id}
            renderItem={renderPlaylistItem}
            ListEmptyComponent={
              <Text style={styles.sheetEmptyText}>
                {isLoadingPlaylists ? 'Loading playlists...' : 'No playlists available.'}
              </Text>
            }
          />
        </BottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        ref={queueSheetRef}
        snapPoints={bottomSheetSnapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetView style={styles.sheetContainer}>
          <Text style={styles.sheetTitle}>Up Next</Text>
          <View style={styles.queueListContainer}>
            <DraggableFlatList
              data={queue}
              keyExtractor={(item) => item.id}
              onDragEnd={handleQueueDragEnd}
              renderItem={renderQueueItem}
              contentContainerStyle={styles.queueListContent}
            />
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    </>
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
    gap: Spacing.xl,
    justifyContent: 'center',
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
  sheetBackground: {
    backgroundColor: Colors.surface,
  },
  sheetHandle: {
    backgroundColor: Colors.muted,
  },
  sheetContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  sheetTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    marginBottom: Spacing.md,
  },
  sheetRow: {
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  sheetRowTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemiBold,
  },
  sheetRowSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 2,
  },
  sheetEmptyText: {
    color: Colors.muted,
    fontSize: Typography.fontSizeMd,
    paddingTop: Spacing.md,
    textAlign: 'center',
  },
  queueListContainer: {
    flex: 1,
  },
  queueListContent: {
    paddingBottom: Spacing.xl,
  },
  queueRow: {
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
    flexDirection: 'row',
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  queueThumb: {
    backgroundColor: Colors.border,
    borderRadius: BorderRadius.sm,
    height: 48,
    width: 48,
  },
  queueMeta: {
    flex: 1,
    marginHorizontal: Spacing.sm,
  },
  queueTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemiBold,
  },
  queueSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 2,
  },
  deleteAction: {
    alignItems: 'center',
    backgroundColor: Colors.error,
    borderRadius: BorderRadius.lg,
    justifyContent: 'center',
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
});
