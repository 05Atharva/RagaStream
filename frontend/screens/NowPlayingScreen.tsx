import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Linking,
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
import { LinearGradient } from 'expo-linear-gradient';
import SafeBlurView from '../components/SafeBlurView';
import SongOptionsSheet from '../components/SongOptionsSheet';
import Slider from '@react-native-community/slider';
import { BottomSheetFlatList, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import SleepTimer from '../components/SleepTimer';
import {
  Gesture,
  GestureDetector,
  Swipeable,
} from 'react-native-gesture-handler';
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import TrackPlayer from '../services/trackPlayerShim';
import {
  isTrackPlayerAvailable,
  onPlaybackProgress,
  togglePlayback as audioToggle,
  seekTo as audioSeekTo,
} from '../services/audioPlayer';
import Toast from 'react-native-toast-message';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { apiClient } from '../services/apiClient';
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
  const { width, height } = useWindowDimensions();
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
  const sleepTimerRef = useRef<BottomSheetModal>(null);
  const songOptionsSheetRef = useRef<BottomSheetModal>(null);

  const albumSize = Math.min(width - MIN_ART_PADDING, height * 0.38, 320);
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
    if (!isTrackPlayerAvailable) {
      // expo-av path: receive live progress from the audioPlayer service
      onPlaybackProgress((_playing, position, duration) => {
        setProgress({ position, duration });
        setPosition(position);
        setDuration(duration);
      });
      return () => {
        // deregister on unmount
        onPlaybackProgress(() => {});
      };
    }

    // RNTP path (native builds): poll every second
    let isMounted = true;
    const syncProgress = async () => {
      try {
        const next = await TrackPlayer.getProgress();
        if (!isMounted) return;
        setProgress({ position: next.position, duration: next.duration });
        setPosition(next.position);
        setDuration(next.duration);
      } catch {
        // ignore while player is idle
      }
    };
    void syncProgress();
    const interval = setInterval(() => void syncProgress(), 1000);
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

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd(() => {
      if (translateY.value > DISMISS_THRESHOLD) {
        translateY.value = withTiming(
          Dimensions.get('window').height,
          { duration: 180 },
          (finished) => {
            if (finished) {
              runOnJS(dismiss)();
            }
          }
        );
        return;
      }
      translateY.value = withSpring(0, {
        damping: 18,
        stiffness: 180,
      });
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
    const nowPlaying = await audioToggle();
    usePlayerStore.setState({ isPlaying: nowPlaying });
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
    await audioSeekTo(value);
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

  const handleShareYouTube = () => {
    if (!youtubeId) return;
    void Linking.openURL(`https://www.youtube.com/watch?v=${youtubeId}`);
  };

  const renderPlaylistItem = ({ item }: { item: PlaylistRecord }) => (
    <Pressable onPress={() => void handleAddToPlaylist(item)} style={styles.sheetRow}>
      <View>
        <Text style={styles.sheetRowTitle}>{item.name}</Text>
        <Text style={styles.sheetRowSubtitle}>{item.songs?.length ?? 0} songs</Text>
      </View>
      <Ionicons name="add-circle-outline" size={22} color="#e2e2e2" />
    </Pressable>
  );

  const renderQueueItem = ({ item, drag, isActive }: RenderItemParams<Track>) => {
    const isCurrent = item.id === currentTrack?.id;
    const thumbnail = item.thumbnail_url || item.thumbnailUrl || item.artwork;
    const itemChannel = item.channel_name || item.channelName || item.artist;

    return (
      <ScaleDecorator>
        <Swipeable
          renderRightActions={() => (
            <Pressable
              onPress={() => void handleRemoveQueueItem(item.id)}
              style={styles.deleteAction}
            >
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            </Pressable>
          )}
        >
          <Pressable
            delayLongPress={150}
            onLongPress={drag}
            style={[
              styles.queueRow,
              isCurrent && styles.queueRowCurrent,
              { opacity: isActive ? 0.85 : 1 },
            ]}
          >
            <View style={styles.queueThumbWrap}>
              {thumbnail ? (
                <Image
                  source={{ uri: thumbnail }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                />
              ) : (
                <Ionicons name="musical-notes" size={16} color="rgba(255,255,255,0.3)" />
              )}
            </View>
            <View style={styles.queueMeta}>
              <Text numberOfLines={1} style={[styles.queueTitle, isCurrent && styles.queueTitleCurrent]}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={styles.queueSubtitle}>{itemChannel}</Text>
            </View>
            <View style={styles.queueRowActions}>
              {!isCurrent && (
                <Pressable
                  onPress={() => void handleRemoveQueueItem(item.id)}
                  style={styles.queueRemoveBtn}
                  hitSlop={4}
                >
                  <Ionicons name="close-outline" size={20} color="rgba(255,255,255,0.4)" />
                </Pressable>
              )}
              <Ionicons name="reorder-three-outline" size={20} color="rgba(255,255,255,0.3)" />
            </View>
          </Pressable>
        </Swipeable>
      </ScaleDecorator>
    );
  };

  if (!currentTrack) {
    return (
      <SafeAreaView style={styles.emptyState}>
        <Pressable hitSlop={8} onPress={dismiss} style={styles.headerBtn}>
          <Ionicons name="chevron-down" size={24} color="rgba(255,255,255,0.9)" />
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.flex, containerAnimatedStyle]}>
          <SafeAreaView style={styles.container}>
            {/* Ambient blurred background */}
            {thumbnailSource ? (
              <>
                <Image
                  source={{ uri: thumbnailSource }}
                  style={[StyleSheet.absoluteFillObject, styles.bgImageTransform]}
                  contentFit="cover"
                />
                <SafeBlurView
                  blurAmount={40}
                  blurType="dark"
                  reducedTransparencyFallbackColor="#000000"
                  style={StyleSheet.absoluteFillObject}
                />
              </>
            ) : null}
            <View style={styles.overlay} />

            {/* Header */}
            <View style={styles.header}>
              <Pressable hitSlop={8} onPress={dismiss} style={styles.headerBtn}>
                <Ionicons name="chevron-down" size={24} color="rgba(255,255,255,0.9)" />
              </Pressable>
              <Text style={styles.headerLabel}>NOW PLAYING</Text>
              <Pressable hitSlop={8} onPress={() => songOptionsSheetRef.current?.present()} style={styles.headerBtn}>
                <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.9)" />
              </Pressable>
            </View>

            {/* Album art */}
            <View style={styles.artSection}>
              <View style={[styles.artworkWrapper, { width: albumSize, height: albumSize }]}>
                <Image
                  source={thumbnailSource ? { uri: thumbnailSource } : undefined}
                  style={styles.artwork}
                  contentFit="cover"
                />
                <View style={styles.youtubeBadge}>
                  <Ionicons name="logo-youtube" size={14} color="#FFFFFF" />
                </View>
              </View>
            </View>

            {/* Player controls */}
            <View style={styles.playerControls}>
              {/* Track meta */}
              <View style={styles.metaSection}>
                <MarqueeText text={currentTrack.title} style={styles.title} />
                <Pressable
                  onPress={() => {
                    if (channelName) {
                      navigation.navigate('Channel', { channelName });
                    }
                  }}
                >
                  <Text numberOfLines={1} style={styles.channelName}>
                    {channelName}
                  </Text>
                </Pressable>
              </View>

              {/* Seek bar */}
              <View style={styles.seekSection}>
                <Slider
                  value={progress.position}
                  minimumValue={0}
                  maximumValue={Math.max(progress.duration, 1)}
                  minimumTrackTintColor="#7C3AED"
                  maximumTrackTintColor="rgba(255,255,255,0.15)"
                  thumbTintColor="#d2bbff"
                  onSlidingComplete={(value) => void handleSeekComplete(value)}
                />
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
                  <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
                </View>
              </View>

              {/* Transport controls */}
              <View style={styles.controlsRow}>
                <Pressable hitSlop={8} onPress={() => void skipPrevious()} style={styles.transportButton}>
                  <Ionicons name="play-skip-back" size={28} color="rgba(255,255,255,0.85)" />
                </Pressable>

                <Pressable hitSlop={8} onPress={() => void togglePlayback()} style={styles.playPauseButton}>
                  <LinearGradient
                    colors={['#7C3AED', '#5B21B6']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={32}
                    color="#FFFFFF"
                    style={!isPlaying ? styles.playIconOffset : undefined}
                  />
                </Pressable>

                <Pressable hitSlop={8} onPress={() => void skipNext()} style={styles.transportButton}>
                  <Ionicons name="play-skip-forward" size={28} color="rgba(255,255,255,0.85)" />
                </Pressable>
              </View>

              {/* Secondary actions glass panel */}
              <View style={styles.actionsPanel}>
                <Animated.View style={heartAnimatedStyle}>
                  <Pressable onPress={() => void handleToggleLike()} style={styles.actionButton}>
                    <Ionicons
                      name={isLiked ? 'heart' : 'heart-outline'}
                      size={24}
                      color={isLiked ? '#F5A623' : 'rgba(255,255,255,0.7)'}
                    />
                  </Pressable>
                </Animated.View>
                <Pressable onPress={() => void handleOpenPlaylists()} style={styles.actionButton}>
                  <Ionicons name="add-circle-outline" size={24} color="rgba(255,255,255,0.7)" />
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => void handleShuffleToggle()}>
                  <Ionicons
                    name="shuffle"
                    size={24}
                    color={shuffle ? '#7C3AED' : 'rgba(255,255,255,0.7)'}
                  />
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => void cycleRepeatMode()}>
                  <Ionicons
                    name={repeatMode === 'one' ? 'repeat-outline' : 'repeat'}
                    size={24}
                    color={repeatMode === 'off' ? 'rgba(255,255,255,0.7)' : '#7C3AED'}
                  />
                </Pressable>
                <Pressable onPress={handleOpenQueue} style={styles.actionButton}>
                  <Ionicons name="list-outline" size={24} color="rgba(255,255,255,0.7)" />
                </Pressable>
                <Pressable style={styles.actionButton} onPress={() => sleepTimerRef.current?.present()}>
                  <Ionicons name="moon-outline" size={24} color="rgba(255,255,255,0.7)" />
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </Animated.View>
      </GestureDetector>

      {/* Add to Playlist sheet */}
      <BottomSheetModal
        ref={playlistsSheetRef}
        snapPoints={bottomSheetSnapPoints}
        backgroundStyle={styles.sheetBg}
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

      {/* Queue sheet */}
      <BottomSheetModal
        ref={queueSheetRef}
        snapPoints={bottomSheetSnapPoints}
        backgroundStyle={styles.queueSheetBg}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetView style={styles.queueSheetContent}>
          <View style={styles.queueSheetHeader}>
            <Text style={styles.queueSheetTitle}>Up Next</Text>
            <Pressable onPress={() => void handleShuffleToggle()} style={styles.queueShuffleBtn}>
              <Ionicons name="shuffle" size={20} color={shuffle ? '#7C3AED' : 'rgba(255,255,255,0.6)'} />
            </Pressable>
          </View>
          <View style={styles.queueListContainer}>
            <DraggableFlatList
              data={queue}
              keyExtractor={(item) => item.id}
              onDragEnd={handleQueueDragEnd}
              renderItem={renderQueueItem}
              contentContainerStyle={styles.queueListContent}
              ListHeaderComponent={
                currentTrack ? (
                  <Text style={styles.queueSectionLabel}>NOW PLAYING</Text>
                ) : undefined
              }
            />
          </View>
        </BottomSheetView>
      </BottomSheetModal>

      {/* Song options sheet */}
      <SongOptionsSheet
        sheetRef={songOptionsSheetRef}
        thumbnail={thumbnailSource}
        title={currentTrack?.title ?? ''}
        channel={channelName}
        onLike={() => void handleToggleLike()}
        onAddToPlaylist={() => void handleOpenPlaylists()}
        onShare={handleShareYouTube}
      />

      <SleepTimer sheetRef={sleepTimerRef} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  emptyState: {
    backgroundColor: '#000000',
    flex: 1,
  },
  bgImageTransform: {
    transform: [{ scale: 1.1 }],
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },

  // ── Header ──
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 20,
    paddingTop: 8,
    zIndex: 1,
  },
  headerBtn: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // ── Album art ──
  artSection: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  artworkWrapper: {
    position: 'relative',
  },
  artwork: {
    backgroundColor: '#121414',
    borderRadius: 16,
    height: '100%',
    width: '100%',
  },
  youtubeBadge: {
    alignItems: 'center',
    backgroundColor: '#FF0000',
    borderRadius: 8,
    bottom: 12,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    width: 30,
  },

  // ── Player controls zone ──
  playerControls: {
    gap: 16,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  metaSection: {
    gap: 4,
  },
  marqueeMask: {
    overflow: 'hidden',
    width: '100%',
  },
  title: {
    color: '#e2e2e2',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  channelName: {
    color: 'rgba(204,195,216,0.75)',
    fontSize: 16,
    fontWeight: '400',
  },
  seekSection: {
    gap: 4,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  timeText: {
    color: 'rgba(204,195,216,0.65)',
    fontSize: 12,
    fontWeight: '600',
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  transportButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  playPauseButton: {
    alignItems: 'center',
    borderRadius: 999,
    elevation: 8,
    height: 64,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    width: 64,
  },
  playIconOffset: {
    marginLeft: 3,
  },
  actionsPanel: {
    alignItems: 'center',
    backgroundColor: 'rgba(26,28,28,0.5)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  actionButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },

  // ── Queue sheet ──
  queueSheetBg: {
    backgroundColor: 'rgba(12,15,15,0.97)',
  },
  queueSheetContent: {
    flex: 1,
    paddingTop: 4,
  },
  queueSheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  queueSheetTitle: {
    color: '#e2e2e2',
    fontSize: 24,
    fontWeight: '700',
  },
  queueShuffleBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(40,42,43,0.5)',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  queueSectionLabel: {
    color: '#7C3AED',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: 12,
    paddingHorizontal: 20,
    textTransform: 'uppercase',
  },
  queueListContainer: {
    flex: 1,
  },
  queueListContent: {
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  queueRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
    padding: 8,
  },
  queueRowCurrent: {
    backgroundColor: 'rgba(124,58,237,0.1)',
    borderColor: 'rgba(124,58,237,0.2)',
    borderWidth: 1,
  },
  queueThumbWrap: {
    alignItems: 'center',
    backgroundColor: '#333535',
    borderRadius: 8,
    flexShrink: 0,
    height: 48,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 48,
  },
  queueMeta: {
    flex: 1,
    minWidth: 0,
  },
  queueTitle: {
    color: '#e2e2e2',
    fontSize: 16,
    fontWeight: '600',
  },
  queueTitleCurrent: {
    color: '#7C3AED',
  },
  queueSubtitle: {
    color: 'rgba(204,195,216,0.7)',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  queueRowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  queueRemoveBtn: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  deleteAction: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#C62828',
    borderRadius: 8,
    justifyContent: 'center',
    marginBottom: 4,
    paddingHorizontal: 20,
  },

  // ── Playlists sheet ──
  sheetBg: {
    backgroundColor: '#1a1c1c',
  },
  sheetHandle: {
    backgroundColor: 'rgba(74,68,85,0.5)',
  },
  sheetContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  sheetTitle: {
    color: '#e2e2e2',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  sheetRow: {
    alignItems: 'center',
    backgroundColor: '#1e2020',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sheetRowTitle: {
    color: '#e2e2e2',
    fontSize: 15,
    fontWeight: '600',
  },
  sheetRowSubtitle: {
    color: 'rgba(204,195,216,0.7)',
    fontSize: 13,
    marginTop: 2,
  },
  sheetEmptyText: {
    color: 'rgba(204,195,216,0.5)',
    fontSize: 15,
    paddingTop: 16,
    textAlign: 'center',
  },
});
