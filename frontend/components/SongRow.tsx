import React, { useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Swipeable } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import EqualizerBars from './EqualizerBars';
import { usePlayerStore } from '../store/playerStore';
import { openSongMenu, type SongMenuOptions } from '../store/songMenuStore';
import * as playback from '../services/playbackController';
import { gestureHaptic } from '../services/haptics';
import { Colors, TypeScale } from '../constants/theme';

export function formatDuration(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

type SongRowProps = {
  song: playback.SongInput;
  onPress: () => void;
  isLoading?: boolean;
  /** Overrides the default "channel · duration" subtitle. */
  subtitle?: string;
  menuOptions?: SongMenuOptions;
  /** Leading index number (charts, popular tracks). */
  index?: number;
  /** Extra element before the ⋮ button (e.g. a drag handle). */
  trailing?: React.ReactNode;
  onLongPress?: () => void;
  swipeToQueue?: boolean;
  /** Enables swipe-left-to-remove (e.g. remove from playlist). */
  onSwipeRemove?: () => void;
};

/**
 * Standard song row: 48px art, title (purple + equalizer when playing),
 * subtitle, ⋮ menu. Long-press opens the menu; swipe right adds to queue.
 */
export default function SongRow({
  song,
  onPress,
  isLoading = false,
  subtitle,
  menuOptions,
  index,
  trailing,
  onLongPress,
  swipeToQueue = true,
  onSwipeRemove,
}: SongRowProps) {
  const swipeRef = useRef<Swipeable>(null);
  const isCurrent = usePlayerStore((s) => (s.currentTrack ? playback.getYoutubeId(s.currentTrack) === song.youtube_id : false));
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const thumbnail = song.thumbnail_url || playback.thumbnailFor(song.youtube_id);
  const duration = formatDuration(song.duration_sec);
  const sub = subtitle ?? [song.channel_name, duration].filter(Boolean).join(' · ');

  const row = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress ?? (() => openSongMenu(song, menuOptions))}
      delayLongPress={300}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {index !== undefined ? <Text style={styles.index}>{index}</Text> : null}
      <View style={styles.thumbWrap}>
        <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        {isLoading ? (
          <View style={styles.thumbOverlay}>
            <ActivityIndicator color="#FFFFFF" size="small" />
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <View style={styles.titleRow}>
          {isCurrent ? <EqualizerBars isPlaying={isPlaying} size="sm" color={Colors.primaryLight} /> : null}
          <Text numberOfLines={1} style={[styles.title, isCurrent && styles.titleActive]}>
            {song.title}
          </Text>
        </View>
        {sub ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {sub}
          </Text>
        ) : null}
      </View>
      {trailing}
      <Pressable
        onPress={() => openSongMenu(song, menuOptions)}
        hitSlop={10}
        style={styles.menuButton}
        accessibilityLabel={`More options for ${song.title}`}
      >
        <Ionicons name="ellipsis-vertical" size={18} color={Colors.textMuted} />
      </Pressable>
    </Pressable>
  );

  if (!swipeToQueue && !onSwipeRemove) return row;

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={72}
      rightThreshold={72}
      renderLeftActions={
        swipeToQueue
          ? () => (
              <View style={styles.queueAction}>
                <Ionicons name="list" size={20} color="#FFFFFF" />
                <Text style={styles.queueActionText}>Add to queue</Text>
              </View>
            )
          : undefined
      }
      renderRightActions={
        onSwipeRemove
          ? () => (
              <View style={styles.removeAction}>
                <Text style={styles.queueActionText}>Remove</Text>
                <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
              </View>
            )
          : undefined
      }
      onSwipeableOpen={(direction) => {
        gestureHaptic();
        swipeRef.current?.close();
        if (direction === 'right') {
          onSwipeRemove?.();
          return;
        }
        void playback.addToQueue(song).then(() => Toast.show({ type: 'success', text1: 'Added to queue' }));
      }}
    >
      {row}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  index: {
    color: Colors.textSubdued,
    fontSize: TypeScale.body,
    textAlign: 'center',
    width: 20,
  },
  thumbWrap: {
    backgroundColor: '#1C1E1E',
    borderRadius: 8,
    height: 48,
    overflow: 'hidden',
    width: 48,
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  title: {
    color: Colors.onBackground,
    flexShrink: 1,
    fontSize: TypeScale.body,
  },
  titleActive: {
    color: Colors.primaryLight,
    fontWeight: '600',
  },
  subtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginTop: 2,
  },
  menuButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 28,
  },
  queueAction: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 20,
  },
  removeAction: {
    alignItems: 'center',
    backgroundColor: Colors.error,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    paddingRight: 20,
  },
  queueActionText: {
    color: '#FFFFFF',
    fontSize: TypeScale.small,
    fontWeight: '700',
  },
});
