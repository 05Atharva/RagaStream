import React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Swipeable } from 'react-native-gesture-handler';
import DraggableFlatList, { type RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import EqualizerBars from './EqualizerBars';
import Button from './ui/Button';
import { SheetHeader } from './ui/SheetRow';
import Text from './ui/Text';
import { usePlayerStore, type Track } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { openSongMenu } from '../store/songMenuStore';
import { gestureHaptic, tapHaptic } from '../services/haptics';
import { Layout, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type QueueSheetProps = {
  isVisible: boolean;
  onClose: () => void;
};

function QueueRow({
  track,
  onPress,
  onLongPress,
  isCurrent = false,
  isPlaying = false,
  draggable = false,
}: {
  track: Track;
  onPress?: () => void;
  onLongPress?: () => void;
  isCurrent?: boolean;
  isPlaying?: boolean;
  draggable?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const thumbnail = track.thumbnail_url || track.thumbnailUrl || track.artwork;
  const channel = track.channel_name || track.channelName || track.artist;

  const row = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={200}
      style={({ pressed }) => [styles.row, isCurrent && styles.rowCurrent, pressed && !isCurrent && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${channel}${isCurrent ? ', now playing' : ''}`}
    >
      <View style={styles.thumb}>
        {thumbnail ? <Image source={{ uri: thumbnail }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : null}
        {isCurrent ? (
          <View style={styles.thumbOverlay}>
            <EqualizerBars isPlaying={isPlaying} size="sm" color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <Text variant="bodyStrong" color={isCurrent ? 'accentInk' : 'text'} numberOfLines={1}>{track.title}</Text>
        <View style={styles.subtitleRow}>
          {track.isRecommendation ? <Ionicons name="sparkles" size={12} color={colors.signal} /> : null}
          <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {track.isRecommendation ? `Smart Shuffle · ${channel}` : channel}
          </Text>
        </View>
      </View>
      {!isCurrent ? (
        <Pressable
          hitSlop={8}
          onPress={() => openSongMenu(playback.trackToSong(track), { queueTrack: track })}
          style={styles.iconButton}
          accessibilityLabel={`More options for ${track.title}`}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
        </Pressable>
      ) : null}
      {draggable ? <Ionicons name="reorder-three" size={22} color={colors.textTertiary} /> : null}
    </Pressable>
  );

  if (isCurrent || !track.queueId) return row;
  return (
    <Swipeable
      rightThreshold={64}
      renderRightActions={() => (
        <View style={styles.deleteAction}>
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
        </View>
      )}
      onSwipeableOpen={() => {
        gestureHaptic();
        playback.removeFromQueue(track.queueId!);
      }}
    >
      {row}
    </Swipeable>
  );
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: Space[2], marginTop: Space[5] }}>
      <Text variant="label" color="textSecondary">{children}</Text>
      {right}
    </View>
  );
}

/** Queue: Now playing → Next in queue (yours) → Next from <context> → Autoplay. */
export default function QueueSheet({ isVisible, onClose }: QueueSheetProps) {
  const { height } = useWindowDimensions();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const userQueue = usePlayerStore((s) => s.userQueue);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const context = usePlayerStore((s) => s.context);

  const upcoming = queue.slice(currentIndex + 1);
  const contextUpcoming = upcoming.filter((t) => !t.isAutoplay);
  const autoplayUpcoming = upcoming.filter((t) => t.isAutoplay);

  const play = (track: Track) => {
    tapHaptic();
    if (track.queueId) void playback.playQueueItem(track.queueId);
  };

  const header = (
    <View>
      {currentTrack ? (
        <>
          <SectionLabel>Now playing</SectionLabel>
          <QueueRow track={currentTrack} isCurrent isPlaying={isPlaying} />
        </>
      ) : null}
      {userQueue.length > 0 ? (
        <>
          <SectionLabel right={<Button label="Clear" size="sm" variant="secondary" onPress={playback.clearUserQueue} />}>
            Next in queue
          </SectionLabel>
          {userQueue.map((track) => (
            <QueueRow key={track.queueId} track={track} onPress={() => play(track)} />
          ))}
        </>
      ) : null}
      {contextUpcoming.length > 0 ? <SectionLabel>{`Next from ${context?.name ?? 'your queue'}`}</SectionLabel> : null}
    </View>
  );

  const footer = (
    <View>
      {autoplayUpcoming.length > 0 ? (
        <>
          <SectionLabel>Autoplay · similar music</SectionLabel>
          {autoplayUpcoming.slice(0, 15).map((track) => (
            <QueueRow key={track.queueId} track={track} onPress={() => play(track)} />
          ))}
        </>
      ) : null}
      {upcoming.length === 0 && userQueue.length === 0 ? (
        <Text variant="caption" color="textSecondary" align="center" style={{ paddingVertical: Space[6] }}>
          Nothing up next. Swipe right on any song, or choose Add to queue from its menu.
        </Text>
      ) : null}
    </View>
  );

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={{ paddingHorizontal: Space[4] }}>
        <SheetHeader title="Queue" subtitle="Hold and drag to reorder · swipe left to remove" />
        <View style={{ height: height * 0.66 }}>
          <DraggableFlatList
            data={contextUpcoming}
            keyExtractor={(item) => item.queueId ?? item.id}
            renderItem={({ item, drag, isActive }: RenderItemParams<Track>) => (
              <ScaleDecorator activeScale={1.03}>
                <View style={{ opacity: isActive ? 0.9 : 1 }}>
                  <QueueRow track={item} onPress={() => play(item)} onLongPress={drag} draggable />
                </View>
              </ScaleDecorator>
            )}
            onDragBegin={gestureHaptic}
            onDragEnd={({ data }) => playback.reorderUpcoming([...data, ...autoplayUpcoming])}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            contentContainerStyle={{ paddingBottom: Space[8] }}
          />
        </View>
      </View>
    </AnimatedBottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: Radius.sm,
    flexDirection: 'row',
    gap: Space[3],
    minHeight: 60,
    paddingHorizontal: Space[2],
  },
  rowCurrent: { backgroundColor: t.colors.accentSoft },
  rowPressed: { backgroundColor: t.colors.surfaceRaised },
  thumb: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.xs + 2, height: 44, overflow: 'hidden', width: 44 },
  thumbOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  meta: { flex: 1, gap: 2, minWidth: 0 },
  subtitleRow: { alignItems: 'center', flexDirection: 'row', gap: Space[1] },
  iconButton: { alignItems: 'center', height: Layout.touchTarget, justifyContent: 'center', width: 32 },
  deleteAction: {
    alignItems: 'flex-end',
    backgroundColor: t.colors.danger,
    borderRadius: Radius.sm,
    flex: 1,
    justifyContent: 'center',
    paddingRight: Space[5],
  },
}));
