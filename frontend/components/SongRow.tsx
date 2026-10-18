import React, { useRef } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Swipeable } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import Toast from '../services/toast';
import EqualizerBars from './EqualizerBars';
import Text from './ui/Text';
import { usePlayerStore } from '../store/playerStore';
import { openSongMenu, type SongMenuOptions } from '../store/songMenuStore';
import * as playback from '../services/playbackController';
import { gestureHaptic } from '../services/haptics';
import { launchFlightFrom } from '../motion/flight';
import { usePressMotion } from '../motion/primitives';
import { Layout, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

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
  /** Leading rank number (charts, popular tracks). */
  index?: number;
  /** Extra element before the ⋮ button (e.g. a drag handle). */
  trailing?: React.ReactNode;
  onLongPress?: () => void;
  swipeToQueue?: boolean;
  /** Enables swipe-left-to-remove (e.g. remove from playlist). */
  onSwipeRemove?: () => void;
};

/**
 * The one song row. 48pt art, title (Kesar + equalizer when it's playing),
 * a quiet secondary line, ⋮ menu. Long-press opens the menu; swipe right
 * queues the song and sends its artwork gliding into the mini player.
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
  const styles = useStyles();
  const colors = useColors();
  const swipeRef = useRef<Swipeable>(null);
  const thumbRef = useRef<View>(null);
  const press = usePressMotion(0.985);
  const isCurrent = usePlayerStore((s) => (s.currentTrack ? playback.getYoutubeId(s.currentTrack) === song.youtube_id : false));
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const thumbnail = song.thumbnail_url || playback.thumbnailFor(song.youtube_id);
  const sub = subtitle ?? [song.channel_name, formatDuration(song.duration_sec)].filter(Boolean).join('  ·  ');

  const queue = () => {
    launchFlightFrom(thumbRef, thumbnail);
    void playback.addToQueue(song).then(() => Toast.show({ type: 'success', text1: 'Added to queue', text2: song.title }));
  };

  const row = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress ?? (() => openSongMenu(song, menuOptions))}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`${song.title}, ${song.channel_name ?? ''}${isCurrent ? ', now playing' : ''}`}
      accessibilityHint="Plays the song. Long-press for more options."
    >
      <Animated.View style={[styles.row, press.style]}>
        {index !== undefined ? (
          <Text variant="mono" color={isCurrent ? 'accentInk' : 'textTertiary'} style={styles.index} tabular>
            {index}
          </Text>
        ) : null}
        <View ref={thumbRef} collapsable={false} style={styles.thumb}>
          <Image source={{ uri: thumbnail }} style={styles.thumbImage} contentFit="cover" transition={150} />
          {isLoading ? (
            <View style={styles.thumbOverlay}>
              <ActivityIndicator color="#FFFFFF" size="small" />
            </View>
          ) : null}
        </View>
        <View style={styles.meta}>
          <View style={styles.titleRow}>
            {isCurrent ? <EqualizerBars isPlaying={isPlaying} size="sm" color={colors.accentInk} /> : null}
            <Text variant="bodyStrong" color={isCurrent ? 'accentInk' : 'text'} numberOfLines={1} style={styles.title}>
              {song.title}
            </Text>
          </View>
          {sub ? <Text variant="caption" color="textSecondary" numberOfLines={1}>{sub}</Text> : null}
        </View>
        {trailing}
        <Pressable
          onPress={() => openSongMenu(song, menuOptions)}
          hitSlop={10}
          style={styles.menuButton}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${song.title}`}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textTertiary} />
        </Pressable>
      </Animated.View>
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
              <View style={[styles.action, styles.queueAction]}>
                <Ionicons name="list" size={20} color={colors.onAccent} />
                <Text variant="captionStrong" color="onAccent">Add to queue</Text>
              </View>
            )
          : undefined
      }
      renderRightActions={
        onSwipeRemove
          ? () => (
              <View style={[styles.action, styles.removeAction]}>
                <Text variant="captionStrong" color="#FFFFFF">Remove</Text>
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
        queue();
      }}
    >
      {row}
    </Swipeable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    alignItems: 'center',
    backgroundColor: t.colors.bg,
    flexDirection: 'row',
    gap: Space[3],
    minHeight: Layout.rowHeight,
    paddingHorizontal: Layout.gutter,
    paddingVertical: Space[2],
  },
  index: { textAlign: 'center', width: 20 },
  thumb: { borderRadius: Radius.sm, height: Layout.thumb, overflow: 'hidden', width: Layout.thumb, backgroundColor: t.colors.surfaceRaised },
  thumbImage: { height: '100%', width: '100%' },
  thumbOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  meta: { flex: 1, gap: 2, minWidth: 0 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: Space[2] },
  title: { flexShrink: 1 },
  menuButton: { alignItems: 'center', height: Layout.touchTarget, justifyContent: 'center', width: 28 },
  action: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: Space[2] },
  queueAction: { backgroundColor: t.colors.accent, paddingLeft: Layout.gutter },
  removeAction: { backgroundColor: t.colors.danger, justifyContent: 'flex-end', paddingRight: Layout.gutter },
}));
